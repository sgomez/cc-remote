const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const Docker = require('dockerode');
const https = require('https');
const path = require('path');
const fs = require('fs');

// Load environment variables if running locally, or default to process.env
const PORT = process.env.WEB_PORT || 4000;
const WEB_PASSWORD = process.env.WEB_PASSWORD;
const OTP_SECRET = process.env.OTP_SECRET;
const JWT_SECRET = process.env.JWT_SECRET || require('crypto').randomBytes(32).toString('hex');
const AGENT_IMAGE = process.env.AGENT_IMAGE || 'cc-remote-claude-agent';

// Host paths and configs to mount to session containers
const CLAUDE_CONFIG_PATH = process.env.CLAUDE_CONFIG_PATH;
const CLAUDE_JSON_PATH = process.env.CLAUDE_JSON_PATH;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIT_USER_NAME = process.env.GIT_USER_NAME || '';
const GIT_USER_EMAIL = process.env.GIT_USER_EMAIL || '';
const PUID = process.env.PUID || '1000';
const PGID = process.env.PGID || '1000';
const PERMISSION_MODE = process.env.PERMISSION_MODE || 'auto';

// Initialize Docker
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const app = express();
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
    if (decoded.authenticated) {
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized.' });
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid.' });
  }
}

// Helper: Make https request to GitHub
function fetchReposFromGithub(token) {
  return new Promise((resolve, reject) => {
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

    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const repos = JSON.parse(data).map(r => ({
              id: r.id,
              full_name: r.full_name,
              private: r.private,
              html_url: r.html_url
            }));
            resolve(repos);
          } catch (e) {
            reject(new Error('Failed to parse GitHub response'));
          }
        } else {
          reject(new Error(`GitHub returned status code ${res.statusCode}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
  });
}

// --- API Endpoints ---

// Check login status
app.get('/api/auth/check', (req, res) => {
  const token = req.cookies.auth_token;
  if (!token) return res.json({ authenticated: false });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return res.json({ authenticated: !!decoded.authenticated });
  } catch (err) {
    return res.json({ authenticated: false });
  }
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { password, otp } = req.body;

  if (!WEB_PASSWORD || !OTP_SECRET) {
    return res.status(500).json({ error: 'Server authentication parameters are not configured in environment.' });
  }

  if (password !== WEB_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password.' });
  }

  // otplib expects base32 secret; verify the TOTP code
  try {
    const isValidOtp = authenticator.check(otp, OTP_SECRET);
    if (!isValidOtp) {
      return res.status(401).json({ error: 'Invalid OTP code.' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'OTP verification failed. Check OTP_SECRET format.' });
  }

  // Issue stateless JWT token cookie valid for 24h
  const token = jwt.sign({ authenticated: true }, JWT_SECRET, { expiresIn: '24h' });
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  });

  return res.json({ success: true });
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
  const { name, repo, clientToken } = req.body;

  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid session name. Must be alphanumeric with hyphens/underscores.' });
  }

  if (!repo || !repo.includes('/')) {
    return res.status(400).json({ error: 'Invalid repository name. Format must be owner/repo.' });
  }

  const containerName = `cc-remote-session-${name}`;
  const volumeName = `cc-remote-workspace-${name}`;
  const tokenToUse = clientToken || GITHUB_TOKEN;

  if (!tokenToUse) {
    return res.status(400).json({ error: 'GitHub Personal Access Token is required to clone the repository.' });
  }

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

    // 3. Set environment variables
    const env = [
      `GITHUB_TOKEN=${tokenToUse}`,
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
        // Do not fail the whole request if the volume delete fails (it might be in use or already gone)
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to delete session: ${err.message}` });
  }
});

// Fetch user repositories from GitHub
app.get('/api/repos', requireAuth, async (req, res) => {
  const clientToken = req.query.token;
  const tokenToUse = clientToken || GITHUB_TOKEN;

  if (!tokenToUse) {
    return res.status(400).json({ error: 'No GitHub token available. Please provide one.' });
  }

  try {
    const repos = await fetchReposFromGithub(tokenToUse);
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
  if (!WEB_PASSWORD || !OTP_SECRET) {
    console.warn(`[Warning] WEB_PASSWORD or OTP_SECRET is NOT set! Authentication will fail.`);
  }
});
