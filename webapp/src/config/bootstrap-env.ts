import { existsSync, readFileSync } from "node:fs";

const BOOTSTRAP_FILE = "/data/bootstrap.json";

if (existsSync(BOOTSTRAP_FILE)) {
  try {
    const content = readFileSync(BOOTSTRAP_FILE, "utf-8");
    const record = JSON.parse(content);
    if (record) {
      if (record.githubClientId) {
        process.env.GITHUB_CLIENT_ID = record.githubClientId;
      }
      if (record.githubClientSecret) {
        process.env.GITHUB_CLIENT_SECRET = record.githubClientSecret;
      }
      if (record.githubAppId) {
        process.env.GITHUB_APP_ID = record.githubAppId;
      }
      if (record.githubAppPrivateKey) {
        process.env.GITHUB_APP_PRIVATE_KEY = record.githubAppPrivateKey;
      }
      if (record.githubAppSlug) {
        process.env.GITHUB_APP_SLUG = record.githubAppSlug;
      }
      if (record.allowedGithubUsers) {
        process.env.ALLOWED_GITHUB_USERS = Array.isArray(record.allowedGithubUsers)
          ? record.allowedGithubUsers.join(",")
          : record.allowedGithubUsers;
      }
    }
  } catch (error) {
    console.error("Failed to load bootstrap configuration:", error);
  }
}
