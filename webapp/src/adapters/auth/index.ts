// Public surface of the auth adapter. The catch-all route delegates to `auth`;
// the delivery layer (#15 WS/SSE, #16 UI) uses the guard and session helpers;
// container-create flows (#13/#14) read the GitHub token server-side.

export { isLoginAllowed, parseAllowList } from "./allow-list";
export { type Auth, auth } from "./auth";
export {
  type AuthSession,
  getGithubAccessToken,
  getSession,
  requireSession,
} from "./session";
