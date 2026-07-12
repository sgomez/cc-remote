// Container-start preflight: validate the infra env before migrations and the
// server boot (wired as `validate:env` in package.json, called by the Docker
// entrypoint). Exits non-zero with the full problem list so a misconfigured
// deployment fails fast and visibly in `docker compose logs` instead of
// half-starting and erroring on the first request.

import { DeploymentConfigError, loadDeploymentConfig } from "./deployment";

try {
  loadDeploymentConfig(process.env);
  console.log("[config] deployment environment OK");
} catch (error) {
  if (error instanceof DeploymentConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
