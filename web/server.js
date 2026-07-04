const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const Docker = require('dockerode');
const https = require('https');
const path = require('path');
const fs = require('fs');

// Environment Variables
const PORT = process.env.WEB_PORT || 4000;
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const ALLOWED_GITHUB_USERS = process.env.ALLOWED_GITHUB_USERS || '';
const JWT_SECRET = process.env.JWT_SECRET || require('crypto').randomBytes(32).toString('hex');
const AGENT_IMAGE = process.env.AGENT_IMAGE || 'cc-remote-claude-agent';

// Host paths to mount to session containers
const CLAUDE_CONFIG_PATH = process.env.CLAUDE_CONFIG_PATH;
const CLAUDE_JSON_PATH = process.env.CLAUDE_JSON_PATH;
const GIT_USER_NAME = process.env.GIT_USER_NAME || '';
const GIT_USER_EMAIL = process.env.GIT_USER_EMAIL || '';
const PUID = process.env.PUID || '1000';
const PGID = process.env.PGID || '1000';
const PERMISSION_MODE = process.env.PERMISSION_MODE || 'auto';

// Initialize Docker
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const app = express();
app.set('trust proxy', true); // Trust Caddy reverse proxy headers
app.use(express.json());
app.use(cookieParser());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Authentication Middleware
function requireAuth(req, res, next) {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized. Please login.' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.authenticated && decoded.accessToken) {
      req.user = decoded;
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized.' });
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
    const decoded = jwt.verify(token, JWT_SECRET);
    return res.json({ 
      authenticated: !!decoded.authenticated, 
      username: decoded.username 
    });
  } catch (err) {
    return res.json({ authenticated: false });
  }
});

// Redirect to GitHub Login page
app.get('/api/auth/login', (req, res) => {
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    return res.status(500).send('GitHub OAuth parameters are not configured in the environment.');
  }

  const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/github/callback`;
  const url = `https://github.com/login/oauth/authorize` + 
              `?client_id=${GITHUB_CLIENT_ID}` +
              `&redirect_uri=${encodeURIComponent(redirectUri)}` +
              `&scope=repo,read:org`;

  res.redirect(url);
});

// OAuth Callback from GitHub
app.get('/api/auth/github/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.redirect('/?error=no_code_provided');
  }

  const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/github/callback`;

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

    // 3. Verify access control list (ALLOWED_GITHUB_USERS)
    const allowedList = ALLOWED_GITHUB_USERS.split(',')
      .map(u => u.trim().toLowerCase())
      .filter(u => u.length > 0);

    if (allowedList.length > 0 && !allowedList.includes(username.toLowerCase())) {
      console.warn(`Access denied for GitHub user: ${username}`);
      return res.redirect('/?error=unauthorized');
    }

    // 4. Issue authenticated session JWT cookie valid for 24h
    const sessionToken = jwt.sign({ 
      authenticated: true, 
      username, 
      accessToken 
    }, JWT_SECRET, { expiresIn: '24h' });

    res.cookie('auth_token', sessionToken, {
      httpOnly: true,
      secure: req.protocol === 'https',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    return res.redirect('/');
  } catch (err) {
    console.error('OAuth Callback Error:', err);
    return res.redirect('/?error=server_error');
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
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
    console.error('Docker error:', err);
    res.status(500).json({ error: 'Failed to retrieve docker container list.' });
  }
});

// Create Session Container + Volume
app.post('/api/sessions', requireAuth, async (req, res) => {
  const { name, repo } = req.body;
  const accessToken = req.user.accessToken;

  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid session name. Must be alphanumeric with hyphens/underscores.' });
  }

  if (!repo || !repo.includes('/')) {
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

    // 4. Create the container
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
      HostConfig: {
        Binds: [
          `${volumeName}:/workspace`,
          `${CLAUDE_CONFIG_PATH}:/home/node/.claude`,
          `${CLAUDE_JSON_PATH}:/home/node/.claude.json`
        ],
        RestartPolicy: { Name: 'unless-stopped' }
      }
    });

    // 5. Start the container
    console.log(`Starting container: ${containerName}`);
    await container.start();

    return res.json({ success: true, message: `Session ${name} created and started.` });
  } catch (err) {
    console.error('Docker operations failed:', err);
    return res.status(500).json({ error: `Failed to create session: ${err.message}` });
  }
});

// Start Session
app.post('/api/sessions/:name/start', requireAuth, async (req, res) => {
  const containerName = `cc-remote-session-${req.params.name}`;
  try {
    const container = docker.getContainer(containerName);
    await container.start();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to start session: ${err.message}` });
  }
});

// Stop Session
app.post('/api/sessions/:name/stop', requireAuth, async (req, res) => {
  const containerName = `cc-remote-session-${req.params.name}`;
  try {
    const container = docker.getContainer(containerName);
    await container.stop();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to stop session: ${err.message}` });
  }
});

// Delete Session
app.post('/api/sessions/:name/delete', requireAuth, async (req, res) => {
  const { name } = req.params;
  const { deleteVolume } = req.body;
  const containerName = `cc-remote-session-${name}`;
  const volumeName = `cc-remote-workspace-${name}`;

  try {
    const container = docker.getContainer(containerName);
    
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
    res.status(500).json({ error: `Failed to delete session: ${err.message}` });
  }
});

// Get Logs
app.get('/api/sessions/:name/logs', requireAuth, async (req, res) => {
  const containerName = `cc-remote-session-${req.params.name}`;
  try {
    const container = docker.getContainer(containerName);
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
    res.status(500).json({ error: `Failed to retrieve logs: ${err.message}` });
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
    res.status(500).json({ error: `Failed to load GitHub repositories: ${err.message}` });
  }
});

// Start Web Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Success] Web Manager listening on port ${PORT}`);
  console.log(`[Config] Default Agent Image: ${AGENT_IMAGE}`);
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    console.warn(`[Warning] GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET is NOT set! OAuth redirects will fail.`);
  }
  if (!ALLOWED_GITHUB_USERS) {
    console.warn(`[Warning] ALLOWED_GITHUB_USERS is empty! Access will be denied for everyone.`);
  }
});
