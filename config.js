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
