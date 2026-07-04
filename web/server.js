const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const Docker = require('dockerode');
const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Environment Variables
const PORT = process.env.WEB_PORT || 4000;
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const ALLOWED_GITHUB_USERS = process.env.ALLOWED_GITHUB_USERS || '';
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const AGENT_IMAGE = process.env.AGENT_IMAGE || 'cc-remote-claude-agent';
// Canonical public base URL (e.g. https://cc.example.com), trailing slash stripped
const BASE_URL = (process.env.BASE_URL || '').replace(/\/+$/, '');

if (!process.env.JWT_SECRET) {
  console.warn('[Warning] JWT_SECRET is not set! A random secret is being generated for this process, which means all sessions will be invalidated on every restart. Set JWT_SECRET in your .env for persistent sessions.');
}

// Host paths to mount to session containers
const CLAUDE_CONFIG_PATH = process.env.CLAUDE_CONFIG_PATH;
const CLAUDE_JSON_PATH = process.env.CLAUDE_JSON_PATH;
const GIT_USER_NAME = process.env.GIT_USER_NAME || '';
const GIT_USER_EMAIL = process.env.GIT_USER_EMAIL || '';
const PUID = process.env.PUID || '1000';
const PGID = process.env.PGID || '1000';
const PERMISSION_MODE = process.env.PERMISSION_MODE || 'auto';

// Input validation patterns
const NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const REPO_REGEX = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

// Initialize Docker (optionally via a socket proxy reachable over TCP)
let docker;
const dockerHostEnv = process.env.DOCKER_HOST;
const dockerHostMatch = dockerHostEnv && dockerHostEnv.match(/^tcp:\/\/([^:/]+):(\d+)$/);
if (dockerHostMatch) {
  docker = new Docker({ protocol: 'http', host: dockerHostMatch[1], port: parseInt(dockerHostMatch[2], 10) });
} else {
  docker = new Docker({ socketPath: '/var/run/docker.sock' });
}

// Server-side session store: sid -> { username, accessToken, expiresAt }
// Keeps the GitHub access token out of the JWT cookie entirely.
const sessions = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// Periodically purge expired sessions
const sessionPurgeInterval = setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(sid);
    }
  }
}, 10 * 60 * 1000);
sessionPurgeInterval.unref();

const app = express();
app.set('trust proxy', 1); // Trust Caddy reverse proxy headers (1 hop)
app.disable('x-powered-by');
app.use(express.json());
app.use(cookieParser());

// Security headers on every response
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (isRequestSecure(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// --- Rate limiting (in-memory fixed window, no new dependencies) ---
function createRateLimiter(windowMs, maxRequests) {
  const hits = new Map(); // ip -> { count, resetAt }

  const purgeInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) {
      if (entry.resetAt <= now) {
        hits.delete(ip);
      }
    }
  }, 5 * 60 * 1000);
  purgeInterval.unref();

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const ip = req.ip;
    let entry = hits.get(ip);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(ip, entry);
    }
    entry.count += 1;
    if (entry.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests.' });
    }
    return next();
  };
}

const strictRateLimit = createRateLimiter(60 * 1000, 10); // 10 req/min
const generalRateLimit = createRateLimiter(60 * 1000, 300); // 300 req/min

app.use('/api/', generalRateLimit);

// --- Helpers ---

// Determine if the incoming request should be treated as secure (https),
// preferring the configured canonical BASE_URL when present.
function isRequestSecure(req) {
  if (BASE_URL) {
    return BASE_URL.startsWith('https:');
  }
  return req.protocol === 'https';
}

// Build the OAuth redirect_uri, preferring the configured canonical BASE_URL.
function getRedirectUri(req) {
  if (BASE_URL) {
    return `${BASE_URL}/api/auth/github/callback`;
  }
  return `${req.protocol}://${req.get('host')}/api/auth/github/callback`;
}

// Inspect a container by session name and confirm it actually belongs to
// cc-remote (carries the expected label) before any operation touches it.
async function getSessionContainer(name) {
  const containerName = `cc-remote-session-${name}`;
  const container = docker.getContainer(containerName);
  let info;
  try {
    info = await container.inspect();
  } catch (err) {
    if (err.statusCode === 404) {
      return null;
    }
    throw err;
  }
  if (!info.Config || !info.Config.Labels || info.Config.Labels['cc-remote-session'] !== 'true') {
    return null;
  }
  return container;
}

// Translate a dockerode/Docker error into a safe, generic client response.
// The full error is always logged server-side.
function sendDockerError(res, err, context) {
  console.error(`${context}:`, err);
  if (err.statusCode === 404) {
    return res.status(404).json({ error: 'Session not found.' });
  }
  if (err.statusCode === 409) {
    return res.status(409).json({ error: 'Conflict with existing container or volume.' });
  }
  return res.status(500).json({ error: 'Internal server error.' });
}

// Authentication Middleware
function requireAuth(req, res, next) {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized. Please login.' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (!decoded.authenticated || !decoded.sid) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    const session = sessions.get(decoded.sid);
    if (!session || session.expiresAt <= Date.now()) {
      return res.status(401).json({ error: 'Session expired or invalid.' });
    }
    req.user = { username: session.username, accessToken: session.accessToken };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid.' });
  }
}

// Helper: General HTTPS Request maker
function makeHttpsRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on('error', (err) => reject(err));
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

// Helper: Make https request to GitHub
async function fetchReposFromGithub(token) {
  const options = {
    hostname: 'api.github.com',
    port: 443,
    path: '/user/repos?per_page=100&sort=updated',
    method: 'GET',
    headers: {
      'User-Agent': 'cc-remote-web-manager',
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json'
    }
  };

  const response = await makeHttpsRequest(options);
  if (response.statusCode === 200) {
    return JSON.parse(response.body).map(r => ({
      id: r.id,
      full_name: r.full_name,
      private: r.private,
      html_url: r.html_url
    }));
  }
  throw new Error(`GitHub returned status code ${response.statusCode}: ${response.body}`);
}

// --- API & Auth Endpoints ---

// Check login status
app.get('/api/auth/check', (req, res) => {
  const token = req.cookies.auth_token;
  if (!token) return res.json({ authenticated: false });
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (!decoded.authenticated || !decoded.sid) {
      return res.json({ authenticated: false });
    }
    const session = sessions.get(decoded.sid);
    if (!session || session.expiresAt <= Date.now()) {
      return res.json({ authenticated: false });
    }
    return res.json({
      authenticated: true,
      username: decoded.username
    });
  } catch (err) {
    return res.json({ authenticated: false });
  }
});

// Redirect to GitHub Login page
app.get('/api/auth/login', strictRateLimit, (req, res) => {
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    return res.status(500).send('GitHub OAuth parameters are not configured in the environment.');
  }

  // CSRF protection: bind this login attempt to a random state value
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax', // must be lax: the callback arrives as a top-level cross-site nav from github.com
    secure: isRequestSecure(req),
    maxAge: 10 * 60 * 1000
  });

  const redirectUri = getRedirectUri(req);
  const url = `https://github.com/login/oauth/authorize` +
              `?client_id=${GITHUB_CLIENT_ID}` +
              `&redirect_uri=${encodeURIComponent(redirectUri)}` +
              `&scope=repo,read:org` +
              `&state=${state}`;

  res.redirect(url);
});

// OAuth Callback from GitHub
app.get('/api/auth/github/callback', strictRateLimit, async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  const storedState = req.cookies.oauth_state;

  res.clearCookie('oauth_state');

  if (!state || !storedState || state !== storedState) {
    console.warn('OAuth callback rejected: missing or mismatched state parameter.');
    return res.redirect('/?error=invalid_state');
  }

  if (!code) {
    return res.redirect('/?error=no_code_provided');
  }

  const redirectUri = getRedirectUri(req);

  try {
    // 1. Exchange authorization code for access token
    const tokenOptions = {
      hostname: 'github.com',
      port: 443,
      path: '/login/oauth/access_token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'cc-remote-web-manager'
      }
    };

    const tokenPostData = JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri
    });

    const tokenResponse = await makeHttpsRequest(tokenOptions, tokenPostData);
    const tokenData = JSON.parse(tokenResponse.body);
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error('Failed to get access token from GitHub:', tokenResponse.body);
      return res.redirect('/?error=token_exchange_failed');
    }

    // 2. Fetch user profile information
    const userOptions = {
      hostname: 'api.github.com',
      port: 443,
      path: '/user',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'cc-remote-web-manager',
        'Accept': 'application/vnd.github+json'
      }
    };

    const userResponse = await makeHttpsRequest(userOptions);
    const userData = JSON.parse(userResponse.body);
    const username = userData.login;

    if (!username) {
      console.error('Failed to retrieve username from GitHub profile:', userResponse.body);
      return res.redirect('/?error=profile_fetch_failed');
    }

    // 3. Verify access control list (ALLOWED_GITHUB_USERS). Fail closed:
    // an empty list means nobody is allowed in, not everybody.
    const allowedList = ALLOWED_GITHUB_USERS.split(',')
      .map(u => u.trim().toLowerCase())
      .filter(u => u.length > 0);

    if (allowedList.length === 0 || !allowedList.includes(username.toLowerCase())) {
      console.warn(`Access denied for GitHub user: ${username}`);
      return res.redirect('/?error=unauthorized');
    }

    // 4. Create a server-side session and issue a JWT cookie that only
    // references it by id. The GitHub access token never enters the cookie.
    const sid = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + SESSION_TTL_MS;
    sessions.set(sid, { username, accessToken, expiresAt });

    const sessionToken = jwt.sign({
      authenticated: true,
      username,
      sid
    }, JWT_SECRET, { expiresIn: '24h' });

    res.cookie('auth_token', sessionToken, {
      httpOnly: true,
      secure: isRequestSecure(req),
      sameSite: 'strict',
      maxAge: SESSION_TTL_MS
    });

    return res.redirect('/');
  } catch (err) {
    console.error('OAuth Callback Error:', err);
    return res.redirect('/?error=server_error');
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies.auth_token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      if (decoded.sid) {
        sessions.delete(decoded.sid);
      }
    } catch (err) {
      // Ignore invalid/expired token; we're clearing the cookie regardless.
    }
  }
  res.clearCookie('auth_token');
  res.json({ success: true });
});

// List Sessions
app.get('/api/sessions', requireAuth, async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: true });

    // Filter and map containers with the label cc-remote-session
    const sessions = containers
      .filter(c => c.Labels && c.Labels['cc-remote-session'] === 'true')
      .map(c => ({
        name: c.Labels['cc-remote-session-name'],
        repo: c.Labels['cc-remote-repo'],
        containerId: c.Id,
        status: c.State, // running, exited, etc.
        created: c.Created
      }));

    res.json(sessions);
  } catch (err) {
    sendDockerError(res, err, 'Failed to list sessions');
  }
});

// Create Session Container + Volume
app.post('/api/sessions', requireAuth, async (req, res) => {
  const { name, repo } = req.body;
  const accessToken = req.user.accessToken;

  if (!name || !NAME_REGEX.test(name)) {
    return res.status(400).json({ error: 'Invalid session name. Must be alphanumeric with hyphens/underscores.' });
  }

  if (!repo || !REPO_REGEX.test(repo)) {
    return res.status(400).json({ error: 'Invalid repository name. Format must be owner/repo.' });
  }

  const containerName = `cc-remote-session-${name}`;
  const volumeName = `cc-remote-workspace-${name}`;

  if (!CLAUDE_CONFIG_PATH || !CLAUDE_JSON_PATH) {
    return res.status(500).json({ error: 'CLAUDE_CONFIG_PATH or CLAUDE_JSON_PATH is not configured on the host.' });
  }

  try {
    // 1. Check if container already exists
    const containers = await docker.listContainers({ all: true });
    const existing = containers.find(c => c.Names.includes(`/${containerName}`));
    if (existing) {
      return res.status(409).json({ error: `Session with name "${name}" already exists.` });
    }

    // 2. Create the workspace volume
    console.log(`Creating Docker workspace volume: ${volumeName}`);
    await docker.createVolume({ Name: volumeName });

    // 3. Set environment variables (injecting OAuth token as GITHUB_TOKEN)
    const env = [
      `GITHUB_TOKEN=${accessToken}`,
      `GITHUB_REPO=${repo}`,
      `GIT_USER_NAME=${GIT_USER_NAME}`,
      `GIT_USER_EMAIL=${GIT_USER_EMAIL}`,
      `PUID=${PUID}`,
      `PGID=${PGID}`,
      `HOME=/home/node`,
      `SESSION_NAME=${name}`,
      `PERMISSION_MODE=${PERMISSION_MODE}`
    ];

    // 4. Harden the container's HostConfig
    const hostConfig = {
      Binds: [
        `${volumeName}:/workspace`,
        `${CLAUDE_CONFIG_PATH}:/home/node/.claude`,
        `${CLAUDE_JSON_PATH}:/home/node/.claude.json`
      ],
      RestartPolicy: { Name: 'unless-stopped' },
      SecurityOpt: ['no-new-privileges:true'],
      PidsLimit: parseInt(process.env.AGENT_PIDS_LIMIT, 10) || 4096
    };

    const memoryLimit = parseInt(process.env.AGENT_MEMORY_LIMIT, 10);
    if (Number.isInteger(memoryLimit) && memoryLimit > 0) {
      hostConfig.Memory = memoryLimit;
    }

    // 5. Create the container
    console.log(`Creating container: ${containerName}`);
    const container = await docker.createContainer({
      Image: AGENT_IMAGE,
      name: containerName,
      Tty: true,
      OpenStdin: true,
      Env: env,
      Labels: {
        'cc-remote-session': 'true',
        'cc-remote-session-name': name,
        'cc-remote-repo': repo
      },
      HostConfig: hostConfig
    });

    // 6. Start the container
    console.log(`Starting container: ${containerName}`);
    await container.start();

    return res.json({ success: true, message: `Session ${name} created and started.` });
  } catch (err) {
    return sendDockerError(res, err, 'Docker operations failed');
  }
});

// Start Session
app.post('/api/sessions/:name/start', requireAuth, async (req, res) => {
  const { name } = req.params;
  if (!NAME_REGEX.test(name)) {
    return res.status(400).json({ error: 'Invalid session name.' });
  }
  try {
    const container = await getSessionContainer(name);
    if (!container) {
      return res.status(404).json({ error: 'Session not found.' });
    }
    await container.start();
    res.json({ success: true });
  } catch (err) {
    sendDockerError(res, err, `Failed to start session ${name}`);
  }
});

// Stop Session
app.post('/api/sessions/:name/stop', requireAuth, async (req, res) => {
  const { name } = req.params;
  if (!NAME_REGEX.test(name)) {
    return res.status(400).json({ error: 'Invalid session name.' });
  }
  try {
    const container = await getSessionContainer(name);
    if (!container) {
      return res.status(404).json({ error: 'Session not found.' });
    }
    await container.stop();
    res.json({ success: true });
  } catch (err) {
    sendDockerError(res, err, `Failed to stop session ${name}`);
  }
});

// Delete Session
app.post('/api/sessions/:name/delete', requireAuth, async (req, res) => {
  const { name } = req.params;
  const { deleteVolume } = req.body;
  const containerName = `cc-remote-session-${name}`;
  const volumeName = `cc-remote-workspace-${name}`;

  if (!NAME_REGEX.test(name)) {
    return res.status(400).json({ error: 'Invalid session name.' });
  }

  try {
    const container = await getSessionContainer(name);
    if (!container) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    // Stop the container if it is running
    try {
      const info = await container.inspect();
      if (info.State.Running) {
        console.log(`Stopping container ${containerName} before deletion...`);
        await container.stop();
      }
    } catch (e) {
      // Ignore if container is not found or fails to inspect
    }

    // Delete container
    console.log(`Removing container ${containerName}...`);
    await container.remove();

    // Optionally delete volume
    if (deleteVolume) {
      console.log(`Removing workspace volume ${volumeName}...`);
      try {
        const volume = docker.getVolume(volumeName);
        await volume.remove();
      } catch (volErr) {
        console.error(`Failed to remove volume ${volumeName}:`, volErr);
      }
    }

    res.json({ success: true });
  } catch (err) {
    sendDockerError(res, err, `Failed to delete session ${name}`);
  }
});

// Get Logs
app.get('/api/sessions/:name/logs', requireAuth, async (req, res) => {
  const { name } = req.params;
  if (!NAME_REGEX.test(name)) {
    return res.status(400).json({ error: 'Invalid session name.' });
  }
  try {
    const container = await getSessionContainer(name);
    if (!container) {
      return res.status(404).json({ error: 'Session not found.' });
    }
    const logBuffer = await container.logs({
      stdout: true,
      stderr: true,
      tail: 150,
      timestamps: false
    });

    let logsText = '';
    let offset = 0;
    while (offset < logBuffer.length) {
      if (offset + 8 > logBuffer.length) break;
      const type = logBuffer.readUInt8(offset);
      const size = logBuffer.readUInt32BE(offset + 4);
      if (offset + 8 + size > logBuffer.length) {
        logsText += logBuffer.slice(offset + 8).toString('utf8');
        break;
      }
      const chunk = logBuffer.slice(offset + 8, offset + 8 + size);
      logsText += chunk.toString('utf8');
      offset += 8 + size;
    }

    if (logsText === '') {
      logsText = logBuffer.toString('utf8');
    }

    // Strip ANSI escape codes (colors, cursor controls, resets)
    const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
    const cleanLogs = logsText
      .replace(ansiRegex, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    res.json({ logs: cleanLogs });
  } catch (err) {
    sendDockerError(res, err, `Failed to retrieve logs for session ${name}`);
  }
});

// Fetch user repositories from GitHub
app.get('/api/repos', requireAuth, async (req, res) => {
  const accessToken = req.user.accessToken;

  try {
    const repos = await fetchReposFromGithub(accessToken);
    res.json(repos);
  } catch (err) {
    console.error('GitHub API error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Start Web Server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Success] Web Manager listening on port ${PORT}`);
  console.log(`[Config] Default Agent Image: ${AGENT_IMAGE}`);
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    console.warn(`[Warning] GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET is NOT set! OAuth redirects will fail.`);
  }
  if (!ALLOWED_GITHUB_USERS) {
    console.warn(`[Warning] ALLOWED_GITHUB_USERS is empty! Access will be denied for everyone.`);
  }
});

// Graceful shutdown handler
async function handleShutdown(signal) {
  console.log(`[Shutdown] Received ${signal}. Stopping sibling agent containers...`);

  try {
    const containers = await docker.listContainers({ all: true });
    // Filter for running containers created by this manager (labeled cc-remote-session)
    const runningSessions = containers.filter(
      c => c.Labels && c.Labels['cc-remote-session'] === 'true' && c.State === 'running'
    );

    if (runningSessions.length > 0) {
      console.log(`[Shutdown] Found ${runningSessions.length} running session container(s) to stop.`);
      await Promise.all(
        runningSessions.map(async (c) => {
          const containerName = c.Names && c.Names[0] ? c.Names[0] : c.Id;
          console.log(`[Shutdown] Stopping sibling container: ${containerName}`);
          try {
            const container = docker.getContainer(c.Id);
            await container.stop();
            console.log(`[Shutdown] Successfully stopped sibling container: ${containerName}`);
          } catch (err) {
            console.error(`[Shutdown] Error stopping container ${containerName}: ${err.message}`);
          }
        })
      );
    } else {
      console.log('[Shutdown] No running agent containers found.');
    }
  } catch (err) {
    console.error('[Shutdown] Failed to query/stop sibling containers:', err.message);
  }

  console.log('[Shutdown] Closing HTTP server...');
  server.close(() => {
    console.log('[Shutdown] HTTP server closed. Exiting process.');
    process.exit(0);
  });

  // Fallback timeout to guarantee process termination
  setTimeout(() => {
    console.error('[Shutdown] Force exiting after timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
