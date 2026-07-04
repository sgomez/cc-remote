const fs = require('fs');
const path = require('path');
const readline = require('readline');
const https = require('https');
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

// Path resolver
function resolvePath(userPath) {
  if (userPath.startsWith('~')) {
    const hostHome = process.env.HOST_HOME || '/root';
    return path.join(hostHome, userPath.slice(1));
  }
  if (!path.isAbsolute(userPath)) {
    const hostPwd = process.env.HOST_PWD || '/app';
    return path.join(hostPwd, userPath);
  }
  return userPath;
}

// GitHub API helper
function fetchGithubIdentity(token) {
  return new Promise((resolve) => {
    if (!token) return resolve(null);
    
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: '/user',
      method: 'GET',
      headers: {
        'User-Agent': 'node-config-agent',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json'
      },
      timeout: 5000
    };

    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            resolve({
              login: parsed.login,
              name: parsed.name || parsed.login,
              email: parsed.email || `${parsed.login}@users.noreply.github.com`
            });
          } catch (e) {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

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

  console.log('\x1b[35m--- GitHub Token Configuration ---\x1b[0m');
  const patUrl = 'https://github.com/settings/personal-access-tokens/new?name=Claude+Code+Remote+Token&description=Token+for+Claude+Code+Remote+Sandbox+with+contents+and+PR+access&metadata=read&contents=write&pull_requests=write&expires_in=none';
  console.log('\n\x1b[36m[Tip] You can quickly generate a Fine-Grained GitHub PAT by opening this link:');
  console.log(`\x1b[34m${patUrl}\x1b[0m\n`);

  const tokenDefault = config.github?.token || '';
  const tokenInput = await questionSecret(`Enter GitHub Personal Access Token (Optional) [${tokenDefault ? 'HIDDEN' : 'none'}]: `);
  const token = tokenInput === '' ? tokenDefault : tokenInput;

  let githubIdentity = null;
  if (token) {
    console.log(' [Info] Fetching identity from GitHub API...');
    githubIdentity = await fetchGithubIdentity(token);
    if (githubIdentity) {
      console.log(` [Info] GitHub User Found: \x1b[34m${githubIdentity.login}\x1b[0m (${githubIdentity.name} <${githubIdentity.email}>)`);
    } else {
      console.log(' \x1b[33m[Warning] Could not retrieve GitHub user. Token might be invalid or rate-limited.\x1b[0m');
    }
  }

  const gitName = githubIdentity?.name || config.git?.name || 'Claude Remote Agent';
  const gitEmail = githubIdentity?.email || config.git?.email || 'agent@example.com';

  console.log('\n\x1b[35m--- Web Manager Configuration ---\x1b[0m');
  const defaultDomain = config.web?.domain || '';
  const domainInput = await question(`Enter your VPS Domain Name (e.g., cc.example.com) [${defaultDomain}]: `);
  const domain = domainInput === '' ? defaultDomain : domainInput;

  const callbackUrl = domain ? `https://${domain}/api/auth/github/callback` : 'http://localhost:4000/api/auth/github/callback';
  const homepageUrl = domain ? `https://${domain}` : 'http://localhost:4000';

  console.log('\n\x1b[36m[Instruction] To configure GitHub OAuth login, create a new OAuth Application on GitHub:');
  console.log('  1. Open: \x1b[34mhttps://github.com/settings/applications/new\x1b[36m');
  console.log('  2. Set Application Name to: \x1b[32mcc-remote-web-manager\x1b[36m');
  console.log(`  3. Set Homepage URL to: \x1b[32m${homepageUrl}\x1b[36m`);
  console.log(`  4. Set Authorization callback URL to: \x1b[32m${callbackUrl}\x1b[36m`);
  console.log('  5. Click "Register application". Then copy the Client ID and generate a Client Secret.\n\x1b[0m');

  const defaultClientId = config.web?.clientId || '';
  const clientIdInput = await question(`Enter your GitHub OAuth Client ID [${defaultClientId}]: `);
  const clientId = clientIdInput === '' ? defaultClientId : clientIdInput;

  const defaultClientSecret = config.web?.clientSecret || '';
  const clientSecretInput = await questionSecret(`Enter your GitHub OAuth Client Secret [${defaultClientSecret ? 'HIDDEN' : 'none'}]: `);
  const clientSecret = clientSecretInput === '' ? defaultClientSecret : clientSecretInput;

  const defaultAllowedUsers = config.web?.allowedUsers || '';
  const allowedUsersInput = await question(`Enter allowed GitHub usernames (comma-separated, e.g., sgomez, user2) [${defaultAllowedUsers}]: `);
  const allowedUsers = allowedUsersInput === '' ? defaultAllowedUsers : allowedUsersInput;

  // Automatic Host & Core Configuration Resolutions
  const webPort = config.web?.port || '4000';
  const githubRepo = config.github?.repo || '';
  const projectPathRaw = config.paths?.workspace || './workspace';
  const projectPath = resolvePath(projectPathRaw);
  const claudeConfigRaw = config.paths?.claudeConfig || '~/.claude';
  const claudeConfig = resolvePath(claudeConfigRaw);
  const claudeJsonRaw = config.paths?.claudeJson || '~/.claude.json';
  const claudeJson = resolvePath(claudeJsonRaw);
  
  const defaultSessionName = config.session?.name || (githubRepo ? path.basename(githubRepo) : path.basename(projectPath));
  const sessionName = defaultSessionName;
  const sessionUuid = config.session?.uuid || '';
  const permissionMode = config.permissions?.mode || 'auto';
  
  const useHeadroom = config.headroom?.enabled || false;
  const headroomConfig = config.headroom?.configPath || resolvePath('~/.headroom');
  const headroomProject = config.headroom?.projectName || '';
  const headroomPort = config.headroom?.hostPort || '8787';

  // Host UID/GID dynamic adapters
  const hostUid = process.env.HOST_UID || '1000';
  const hostGid = process.env.HOST_GID || '1000';

  // Construct JSON config
  const finalConfig = {
    github: {
      token: token,
      repo: githubRepo
    },
    git: {
      name: gitName,
      email: gitEmail
    },
    paths: {
      workspace: projectPathRaw,
      claudeConfig: claudeConfigRaw,
      claudeJson: claudeJsonRaw
    },
    session: {
      name: sessionName,
      uuid: sessionUuid
    },
    permissions: {
      mode: permissionMode
    },
    web: {
      domain: domain,
      clientId: clientId,
      clientSecret: clientSecret,
      allowedUsers: allowedUsers,
      port: webPort
    },
    headroom: {
      enabled: useHeadroom,
      configPath: headroomConfig,
      projectName: headroomProject,
      hostPort: headroomPort
    },
    user: {
      puid: hostUid,
      pgid: hostGid
    }
  };

  // Save config.json
  fs.writeFileSync(configFile, JSON.stringify(finalConfig, null, 2), 'utf8');
  console.log(`\n\x1b[32m[Success] Configuration saved to ${configFile}\x1b[0m`);

  // Build .env file contents
  const envContent = [
    `# Auto-generated configuration by config.js`,
    `GITHUB_TOKEN="${token}"`,
    `GITHUB_REPO="${githubRepo}"`,
    `GIT_USER_NAME="${gitName}"`,
    `GIT_USER_EMAIL="${gitEmail}"`,
    `PROJECT_PATH="${projectPath}"`,
    `CLAUDE_CONFIG_PATH="${claudeConfig}"`,
    `CLAUDE_JSON_PATH="${claudeJson}"`,
    `SESSION_NAME="${sessionName}"`,
    `SESSION_UUID="${sessionUuid}"`,
    `PERMISSION_MODE="${permissionMode}"`,
    `DOMAIN_NAME="${domain}"`,
    `GITHUB_CLIENT_ID="${clientId}"`,
    `GITHUB_CLIENT_SECRET="${clientSecret}"`,
    `ALLOWED_GITHUB_USERS="${allowedUsers}"`,
    `WEB_PORT="${webPort}"`,
    `HEADROOM_CONFIG_PATH="${headroomConfig}"`,
    `HEADROOM_PROJECT_NAME="${headroomProject}"`,
    `HEADROOM_HOST_PORT="${headroomPort}"`,
    `COMPOSE_PROFILES="${useHeadroom ? 'headroom' : ''}"`,
    `ANTHROPIC_BASE_URL="${useHeadroom ? `http://headroom:8787/p/${headroomProject}` : ''}"`,
    `PUID="${hostUid}"`,
    `PGID="${hostGid}"`
  ].join('\n') + '\n';

  fs.writeFileSync('.env', envContent, 'utf8');
  console.log('\x1b[32m[Success] Environment variables compiled to .env\x1b[0m\n');

  rl.close();
}

main().catch(err => {
  console.error('\x1b[31m[Error] Setup process failed:\x1b[0m', err);
  process.exit(1);
});
