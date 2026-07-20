const fs = require('fs');
const readline = require('readline');
const crypto = require('crypto');

// Helper to prompt user
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

// --- Agent resource limits (S4) -------------------------------------------------
//
// Agent containers run untrusted, AI-generated code under `--permission-mode auto`.
// With no memory cap, one runaway build or alloc bomb exhausts the VPS's RAM and the
// kernel takes down every Session AND web-manager — the very thing you'd use to log
// in from your phone and fix it. So every agent container gets a hard cap.
//
// The value can't be a constant (it depends on the host) and web-manager can't
// discover it at runtime (`docker info` is blocked on the socket proxy, deliberately).
// setup.sh CAN see the host, so it measures RAM/CPUs and passes them in here, and we
// derive a default with no extra prompt — the same way the wizard already derives the
// auth secret, PUID/PGID and permission mode.
//
// THE ASSUMPTION THIS ENCODES, stated so you can disagree with it: about TWO Sessions
// are memory-hot at the same time, and the control plane + host need ~1 GiB. This is a
// fleet manager, so the cap is PER CONTAINER and is NOT a total — N running Sessions
// can still add up past RAM. It is a blast-radius limit (one bad agent can't take the
// box), not an admission controller. Run many heavy Sessions at once and you can still
// overcommit; lower the value (see below) if you plan to.
const MEM_RESERVE_MB = 1024; // host OS + web-manager (Node SSR) + caddy + socket proxy
const MEM_ASSUMED_CONCURRENT = 2; // Sessions assumed memory-hot at once
const MEM_FLOOR_MB = 512; // below this Claude Code itself is unusable
const MEM_CEIL_MB = 8192; // past this you're just letting a runaway eat more
const MEM_GRANULARITY_MB = 128; // round down to a tidy value

function deriveMemoryLimitMb(hostMemMb) {
  if (!hostMemMb || hostMemMb <= 0) return MEM_FLOOR_MB; // unknown host: be conservative
  const budget = (hostMemMb - MEM_RESERVE_MB) / MEM_ASSUMED_CONCURRENT;
  const rounded = Math.floor(budget / MEM_GRANULARITY_MB) * MEM_GRANULARITY_MB;
  // Clamp. The floor matters most: a 2 GiB VPS derives exactly 512m, and anything
  // under ~512m makes Claude Code itself unusable (Docker's own minimum is 6m, which
  // is useless here). The ceiling matters on big hosts: no single agent needs more
  // than 8 GiB, and a bigger cap only widens the blast radius.
  return Math.min(Math.max(rounded, MEM_FLOOR_MB), MEM_CEIL_MB);
}

// CPU is a throttle, not a killer: a pegged core degrades the box, it doesn't OOM it.
// The cap exists so one runaway `make -j` can't starve web-manager of the CPU it needs
// to still answer "stop that Session". Half the host's cores (min 1) leaves the control
// plane room while letting a normal parallel `pnpm build` inside an agent run at real
// speed.
function deriveCpuLimit(hostCpus) {
  const cpus = Number.parseInt(hostCpus, 10);
  if (!Number.isInteger(cpus) || cpus < 1) return 1;
  return Math.max(1, Math.floor(cpus / 2));
}

// Mirror of parseMemoryBytes() in webapp/src/adapters/docker/config.ts — this file runs
// in a throwaway node:22-slim container and cannot import the webapp's TypeScript. Keep
// the two in sync. Validation lives HERE so a bad value is caught in the wizard, where a
// human is looking at it, and not at 3am in `docker compose logs`.
const MIN_MEMORY_BYTES = 6 * 1024 * 1024; // Docker's own --memory minimum
function parseMemoryBytes(value) {
  const raw = String(value ?? '').trim();
  if (raw === '') return 0;
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*([bkmg])?b?$/i);
  if (!match) throw new Error(`"${raw}" is not a byte count or a size like 512m / 2g / 1.5g`);
  const scale = { b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[(match[2] || 'b').toLowerCase()];
  const bytes = Math.floor(Number.parseFloat(match[1]) * scale);
  if (bytes === 0) return 0; // explicit opt-out
  if (bytes < MIN_MEMORY_BYTES) {
    throw new Error(`"${raw}" is below Docker's 6m minimum (${bytes} bytes)`);
  }
  return bytes;
}

function parseCpuLimit(value) {
  const raw = String(value ?? '').trim();
  if (raw === '') return 0;
  if (!/^\d+(?:\.\d+)?$/.test(raw)) {
    throw new Error(`"${raw}" is not a positive number of CPU cores (e.g. 1, 1.5, 0.5)`);
  }
  return Number.parseFloat(raw);
}

/**
 * Resolve the agent limits: a value already in config.json (ours from a previous run, or
 * the user's own edit) is kept; otherwise derive one from the host. Validates either way,
 * and always explains what it picked — a silent cap that strangles a build is worse than
 * a loud one.
 */
function resolveAgentLimits(config) {
  const hostMemMb = Number.parseInt(process.env.HOST_MEM_MB || '', 10);
  const hostCpus = process.env.HOST_CPUS || '';

  const configuredMem = config.resources?.agentMemoryLimit;
  const configuredCpu = config.resources?.agentCpuLimit;
  const wasConfigured = configuredMem != null || configuredCpu != null;

  const memoryLimit = configuredMem || `${deriveMemoryLimitMb(hostMemMb)}m`;
  const cpuLimit = configuredCpu != null ? String(configuredCpu) : String(deriveCpuLimit(hostCpus));

  // Validate BOTH paths (a hand-edited config.json is exactly where a typo lands).
  let memoryBytes;
  try {
    memoryBytes = parseMemoryBytes(memoryLimit);
    parseCpuLimit(cpuLimit);
  } catch (e) {
    console.error(`\n\x1b[31m[Error] Invalid agent resource limit in config.json: ${e.message}\x1b[0m`);
    console.error('\x1b[31m        Fix "resources" in config.json (e.g. "agentMemoryLimit": "2g", "agentCpuLimit": 2) and rerun.\x1b[0m');
    process.exit(1);
  }

  console.log('\n\x1b[35m--- Agent Resource Limits ---\x1b[0m');
  const hostDesc = hostMemMb > 0 ? `${(hostMemMb / 1024).toFixed(1)} GiB RAM / ${hostCpus || '?'} CPUs` : 'unknown (host RAM not detected)';
  console.log(`Host: ${hostDesc}`);
  if (wasConfigured) {
    console.log(`\x1b[36mKeeping the values already in config.json: memory=${memoryLimit}, cpus=${cpuLimit}\x1b[0m`);
    console.log('  Delete the "resources" block from config.json to re-derive them from this host.');
  } else {
    console.log(`\x1b[36mDerived per-container caps: memory=${memoryLimit}, cpus=${cpuLimit}\x1b[0m`);
    console.log(`  memory = (host RAM - ${MEM_RESERVE_MB}m reserved for the host + web-manager + caddy + proxy) / ${MEM_ASSUMED_CONCURRENT} concurrent Sessions,`);
    console.log(`           clamped to [${MEM_FLOOR_MB}m, ${MEM_CEIL_MB}m]. Swap is disabled, so this is a HARD ceiling.`);
    console.log(`  cpus   = half the host's cores (min 1), so a runaway build can't starve web-manager.`);
  }
  console.log('\x1b[33mThis is a PER-CONTAINER cap, not a fleet total: enough Sessions at once can still\x1b[0m');
  console.log('\x1b[33moverspend the host. To change it, edit "resources" in config.json (NOT .env, which is\x1b[0m');
  console.log('\x1b[33mrecompiled from config.json on every ./setup.sh run) and rerun ./setup.sh.\x1b[0m');
  if (memoryBytes > 0 && memoryBytes < 1024 ** 3) {
    console.log('\x1b[33m[Warning] Under 1 GiB per agent: a large `pnpm build`/`cargo build` inside a Session\x1b[0m');
    console.log('\x1b[33m          may get OOM-killed (it will show up as a red "crashed" badge). Consider a\x1b[0m');
    console.log('\x1b[33m          bigger host, or raise the value and run fewer Sessions at once.\x1b[0m');
  }

  return { memoryLimit, cpuLimit };
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

  // No git identity here. It used to be resolved from the host's global git
  // config, but this wizard runs inside a throwaway node:22-slim container that
  // never mounts ~/.gitconfig, so the lookup always failed and every deployment
  // silently got the "Claude Remote Agent" fallback -- an address GitHub
  // attributes to nobody. A Session's git author is now the Commit Identity of
  // the signed-in user who provisions it, derived from their GitHub profile at
  // create time. See docs/adr/0002-per-user-commit-identity.md.

  // Reuse a previously generated better-auth signing secret if we have one, otherwise
  // generate a new one. Stable across restarts, or every restart invalidates all
  // logged-in sessions.
  const betterAuthSecret = config.web?.betterAuthSecret || crypto.randomBytes(32).toString('hex');

  console.log('\n\x1b[35m--- Web Manager Infrastructure ---\x1b[0m');

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

  console.log('\n\x1b[36mPhase 1 complete. After the stack is running, open it in your browser\x1b[0m');
  console.log('\x1b[36mto complete Phase 2: registering the GitHub App and configuring sign-in.\x1b[0m');
  console.log('\x1b[36mRun \x1b[1mdocker compose logs web-manager\x1b[0m\x1b[36m to find the Claim Token.\x1b[0m\n');

  // Automatic Host & Core Resolutions. Everything below is derived or defaulted —
  // no prompt. Sessions are created in the web UI (each one names itself, picks its
  // repo and its Account, and gets its own workspace volume), so the wizard has no
  // repo, session or host-path questions left to ask.
  const webPort = config.web?.port || '4000';

  // Host UID/GID dynamic adapters
  const hostUid = process.env.HOST_UID || '1000';
  const hostGid = process.env.HOST_GID || '1000';

  // Derived (or overridden) per-container memory/CPU caps. Exits non-zero on a bad value.
  const limits = resolveAgentLimits(config);

  // Construct JSON config — infrastructure only. GitHub identity (App ID, slug,
  // private key, OAuth client credentials, allow-list) is configured through the
  // browser bootstrap screen in Phase 2 and stored in the Bootstrap File on the
  // persisted data volume, not in config.json or .env.
  const finalConfig = {
    web: {
      domain: domain,
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
    },
    // Per-container agent caps. Written back on every run so they are visible and
    // hand-editable: change them HERE (not in .env, which is recompiled from this
    // file) and rerun ./setup.sh. Once set, an explicit value is kept as an override
    // and is never re-derived — clear the key to go back to host-derived defaults.
    resources: {
      agentMemoryLimit: limits.memoryLimit,
      agentCpuLimit: limits.cpuLimit
    }
  };

  // Save config.json
  fs.writeFileSync(configFile, JSON.stringify(finalConfig, null, 2), 'utf8');
  // S4 hardening: this file holds BETTER_AUTH_SECRET in plain text. 0600 so
  // only the owner (the host user this container was run as, via HOST_UID/HOST_GID)
  // can read it, not every local user on the box.
  fs.chmodSync(configFile, 0o600);
  console.log(`\n\x1b[32m[Success] Configuration saved to ${configFile}\x1b[0m`);

  // Calculate port bind string
  const caddyHttpPortBind = (enableCaddy && httpPort > 0) ? `${httpPort}:80` : '127.0.0.1:40080:80';

  // BETTER_AUTH_URL is the public origin better-auth signs cookies / builds the
  // GitHub OAuth callback against. Always non-empty. With Caddy enabled the
  // scheme is always https; with Caddy disabled, http for localhost and https
  // for non-localhost (expects an external TLS reverse proxy).
  // Replaces the legacy BASE_URL.
  const isLocal = domain.startsWith('localhost') || domain.startsWith('127.0.0.1');
  const betterAuthUrl = enableCaddy
    ? `https://${domain}`
    : isLocal
      ? `http://${domain}`
      : `https://${domain}`;

  // Build .env file contents. Infra only — GitHub identity (OAuth client credentials,
  // App ID, private key, slug, allow-list) is configured through the browser bootstrap
  // screen (Phase 2) and stored in the Bootstrap File on the persisted data volume.
  // Provider/account data lives in the web UI + SQLite, and every Session's
  // repo/name/identity is per-session state held by Docker. No host paths: agent
  // containers mount named volumes exclusively.
  const envContent = [
    `# Auto-generated configuration by config.js`,
    `DOMAIN_NAME="${domain}"`,
    `BETTER_AUTH_URL="${betterAuthUrl}"`,
    `WEB_PORT="${webPort}"`,
    `CADDY_HTTP_PORT_BIND="${caddyHttpPortBind}"`,
    `CADDY_HTTPS_PORT="${httpsPort}"`,
    `COMPOSE_PROFILES="${enableCaddy ? 'caddy' : ''}"`,
    `PUID="${hostUid}"`,
    `PGID="${hostGid}"`,
    `BETTER_AUTH_SECRET="${betterAuthSecret}"`,
    ``,
    `# Per-container agent resource caps, derived from this host by config.js (see the`,
    `# "resources" block in config.json to change them — editing THIS file won't survive`,
    `# a ./setup.sh rerun). Memory accepts human units (512m, 2g, 1.5g) or raw bytes;`,
    `# swap is pinned to the same value, so it is a hard ceiling. CPU is in cores.`,
    `AGENT_MEMORY_LIMIT="${limits.memoryLimit}"`,
    `AGENT_CPU_LIMIT="${limits.cpuLimit}"`
  ].join('\n') + '\n';

  fs.writeFileSync('.env', envContent, 'utf8');
  // S4 hardening: this file holds BETTER_AUTH_SECRET in plain text.
  fs.chmodSync('.env', 0o600);
  console.log('\x1b[32m[Success] Environment variables compiled to .env\x1b[0m\n');

  rl.close();
}

main().catch(err => {
  console.error('\x1b[31m[Error] Setup process failed:\x1b[0m', err);
  process.exit(1);
});
