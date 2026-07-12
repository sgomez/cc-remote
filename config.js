const fs = require('fs');
const readline = require('readline');
const crypto = require('crypto');
const { execSync } = require('child_process');

// Helper to prompt user
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

const questionSecret = (query) => new Promise((resolve) => {
  const oldWrite = rl._writeToOutput;
  let isMuted = false;

  rl._writeToOutput = function _writeToOutput(stringToWrite) {
    if (!isMuted) {
      rl.output.write(stringToWrite);
      return;
    }
    if (stringToWrite === '\r\n' || stringToWrite === '\n' || stringToWrite === '\r') {
      rl.output.write(stringToWrite);
      return;
    }
  };

  rl.question(query, (answer) => {
    rl._writeToOutput = oldWrite;
    resolve(answer);
  });

  isMuted = true;
});

async function main() {
  let config = {};
  const configFile = 'config.json';
  
  if (fs.existsSync(configFile)) {
    try {
      config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      console.log('\x1b[33m[Info] Loaded existing config.json.\x1b[0m');
    } catch (e) {
      console.log('\x1b[31m[Warning] Could not parse config.json, starting fresh.\x1b[0m');
    }
  }

  // Resolve Git configurations from host globally
  let gitName = config.git?.name || '';
  let gitEmail = config.git?.email || '';

  try {
    if (!gitName) {
      gitName = execSync('git config --global user.name', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    }
  } catch (e) {}

  try {
    if (!gitEmail) {
      gitEmail = execSync('git config --global user.email', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    }
  } catch (e) {}

  if (!gitName) gitName = 'Claude Remote Agent';
  if (!gitEmail) gitEmail = 'agent@example.com';

  // Reuse a previously generated better-auth signing secret if we have one, otherwise
  // generate a new one. Stable across restarts, or every restart invalidates all
  // logged-in sessions.
  const betterAuthSecret = config.web?.betterAuthSecret || crypto.randomBytes(32).toString('hex');

  console.log('\n\x1b[35m--- Web Manager Configuration ---\x1b[0m');
  
  // Prompt for Caddy Enablement
  const defaultEnableCaddy = config.web?.caddy?.enabled !== undefined ? config.web.caddy.enabled : false;
  const enableCaddyInput = await question(`Enable Caddy reverse proxy? (y/N) [${defaultEnableCaddy ? 'y' : 'n'}]: `);
  let enableCaddy = defaultEnableCaddy;
  if (enableCaddyInput !== '') {
    enableCaddy = ['y', 'yes'].includes(enableCaddyInput.toLowerCase().trim());
  }

  let domain = '';
  let httpPort = 80;
  let httpsPort = 443;

  if (enableCaddy) {
    const defaultDomain = config.web?.domain || '';
    const domainInput = await question(`Enter your VPS Domain Name (e.g., cc.example.com) [${defaultDomain}]: `);
    domain = domainInput === '' ? defaultDomain : domainInput.trim();

    const defaultHttpPort = config.web?.caddy?.httpPort !== undefined ? config.web.caddy.httpPort : 80;
    const httpPortInput = await question(`Enter Caddy HTTP Port (0 to disable) [${defaultHttpPort}]: `);
    httpPort = httpPortInput === '' ? defaultHttpPort : parseInt(httpPortInput.trim(), 10);

    const defaultHttpsPort = config.web?.caddy?.httpsPort || 443;
    const httpsPortInput = await question(`Enter Caddy HTTPS Port [${defaultHttpsPort}]: `);
    httpsPort = httpsPortInput === '' ? defaultHttpsPort : parseInt(httpsPortInput.trim(), 10);
  } else {
    // Caddy disabled: Ask for Domain/IP for Callback URI construction
    const defaultDomain = config.web?.domain || 'localhost:4000';
    const domainInput = await question(`Enter Domain Name or Host:Port for Callback URI (e.g. cc.example.com or localhost:4000) [${defaultDomain}]: `);
    domain = domainInput === '' ? defaultDomain : domainInput.trim();
    httpPort = 0;
    httpsPort = 443;
  }

  // Calculate Callback and Homepage URLs
  let callbackUrl = '';
  let homepageUrl = '';
  // better-auth serves the GitHub OAuth callback at /api/auth/callback/github
  // (its catch-all route), NOT the legacy Express /api/auth/github/callback.
  if (enableCaddy) {
    callbackUrl = `https://${domain}/api/auth/callback/github`;
    homepageUrl = `https://${domain}`;
  } else {
    const isLocal = domain.startsWith('localhost') || domain.startsWith('127.0.0.1');
    const scheme = isLocal ? 'http' : 'https';
    callbackUrl = `${scheme}://${domain}/api/auth/callback/github`;
    homepageUrl = `${scheme}://${domain}`;
  }

  console.log('\n\x1b[36m[Instruction] To configure GitHub OAuth login, create a new OAuth Application on GitHub:');
  console.log('  1. Open: \x1b[34mhttps://github.com/settings/applications/new\x1b[36m');
  console.log('  2. Set Application Name to: \x1b[32mcc-remote-web-manager\x1b[36m');
  console.log(`  3. Set Homepage URL to: \x1b[32m${homepageUrl}\x1b[36m`);
  console.log(`  4. Set Authorization callback URL to: \x1b[32m${callbackUrl}\x1b[36m`);
  console.log('  5. Click "Register application". Then copy the Client ID and generate a Client Secret.\n\x1b[0m');

  const defaultClientId = config.web?.clientId || '';
  const clientIdInput = await question(`Enter your GitHub OAuth Client ID [${defaultClientId}]: `);
  const clientId = clientIdInput === '' ? defaultClientId : clientIdInput.trim();

  const defaultClientSecret = config.web?.clientSecret || '';
  const clientSecretInput = await questionSecret(`Enter your GitHub OAuth Client Secret [${defaultClientSecret ? 'HIDDEN' : 'none'}]: `);
  const clientSecret = clientSecretInput === '' ? defaultClientSecret : clientSecretInput.trim();

  const defaultAllowedUsers = config.web?.allowedUsers || '';
  const allowedUsersInput = await question(`Enter allowed GitHub usernames (comma-separated, e.g., sgomez, user2) [${defaultAllowedUsers}]: `);
  const allowedUsers = allowedUsersInput === '' ? defaultAllowedUsers : allowedUsersInput.trim();

  // Automatic Host & Core Resolutions. Everything below is derived or defaulted —
  // no prompt. Sessions are created in the web UI (each one names itself, picks its
  // repo and its Account, and gets its own workspace volume), so the wizard has no
  // repo, session or host-path questions left to ask.
  const webPort = config.web?.port || '4000';
  const permissionMode = config.permissions?.mode || 'auto';

  // Host UID/GID dynamic adapters
  const hostUid = process.env.HOST_UID || '1000';
  const hostGid = process.env.HOST_GID || '1000';

  // Construct JSON config
  const finalConfig = {
    git: {
      name: gitName,
      email: gitEmail
    },
    permissions: {
      mode: permissionMode
    },
    web: {
      domain: domain,
      clientId: clientId,
      clientSecret: clientSecret,
      allowedUsers: allowedUsers,
      port: webPort,
      betterAuthSecret: betterAuthSecret,
      caddy: {
        enabled: enableCaddy,
        httpPort: httpPort,
        httpsPort: httpsPort
      }
    },
    user: {
      puid: hostUid,
      pgid: hostGid
    }
  };

  // Save config.json
  fs.writeFileSync(configFile, JSON.stringify(finalConfig, null, 2), 'utf8');
  console.log(`\n\x1b[32m[Success] Configuration saved to ${configFile}\x1b[0m`);

  // Calculate port bind string
  const caddyHttpPortBind = (enableCaddy && httpPort > 0) ? `${httpPort}:80` : '127.0.0.1:40080:80';

  // BETTER_AUTH_URL is the public origin better-auth signs cookies / builds the
  // GitHub OAuth callback against. Always non-empty (homepageUrl covers the
  // Caddy-fronted https case and the local http case). Replaces the legacy BASE_URL.
  const betterAuthUrl = homepageUrl;

  // Build .env file contents. Infra only — provider/account data lives in the web
  // UI + SQLite, and every Session's repo/name/identity is per-session state held
  // by Docker. No host paths: agent containers mount named volumes exclusively.
  const envContent = [
    `# Auto-generated configuration by config.js`,
    `GIT_USER_NAME="${gitName}"`,
    `GIT_USER_EMAIL="${gitEmail}"`,
    `PERMISSION_MODE="${permissionMode}"`,
    `DOMAIN_NAME="${domain}"`,
    `BETTER_AUTH_URL="${betterAuthUrl}"`,
    `GITHUB_CLIENT_ID="${clientId}"`,
    `GITHUB_CLIENT_SECRET="${clientSecret}"`,
    `ALLOWED_GITHUB_USERS="${allowedUsers}"`,
    `WEB_PORT="${webPort}"`,
    `CADDY_HTTP_PORT_BIND="${caddyHttpPortBind}"`,
    `CADDY_HTTPS_PORT="${httpsPort}"`,
    `COMPOSE_PROFILES="${enableCaddy ? 'caddy' : ''}"`,
    `PUID="${hostUid}"`,
    `PGID="${hostGid}"`,
    `BETTER_AUTH_SECRET="${betterAuthSecret}"`
  ].join('\n') + '\n';

  fs.writeFileSync('.env', envContent, 'utf8');
  console.log('\x1b[32m[Success] Environment variables compiled to .env\x1b[0m\n');

  rl.close();
}

main().catch(err => {
  console.error('\x1b[31m[Error] Setup process failed:\x1b[0m', err);
  process.exit(1);
});
