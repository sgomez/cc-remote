// better-auth configuration (v1.6, research #2). GitHub social login with a
// fail-closed allow-list and server-side access-token retrieval, on the SAME
// SQLite file as MikroORM but via better-auth's OWN built-in engine (#5: the
// community MikroORM adapter was rejected). `@better-auth/cli generate|migrate`
// owns better-auth's tables — see the `auth:*` scripts in package.json.
//
// This module is the config the CLI loads (`--config src/adapters/auth/auth.ts`)
// and the handler the TSS catch-all route delegates to.

import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import Database from "better-sqlite3";
import { debug } from "../../debug";
import { DB_PATH, ensureDbDir } from "../db/db-path";
import { isLoginAllowed, parseAllowList } from "./allow-list";
import { githubAdditionalFields, mapGithubProfileToUser } from "./github-profile";
import { GITHUB_OAUTH_SCOPE } from "./github-scope";

const log = debug("auth");
const ALLOWED = parseAllowList(process.env.ALLOWED_GITHUB_USERS);

ensureDbDir();
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

export const auth = betterAuth({
  database: db,
  // Stable across restarts, or every restart invalidates all sessions
  // (see the Auth section in AGENTS.md / CLAUDE.md).
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  user: {
    // `githubLogin` persisted from the verified GitHub profile; see
    // github-profile.ts for why it must stay inputtable.
    additionalFields: githubAdditionalFields,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
      // `user:email` is mandatory for better-auth's GitHub provider. GitHub Apps
      // ignore authorisation-URL scopes; permissions come from the App's own
      // configuration.
      scope: [...GITHUB_OAUTH_SCOPE],
      mapProfileToUser: mapGithubProfileToUser,
    },
  },
  databaseHooks: {
    // Belt: reject the very first sign-up of a non-listed user (githubLogin is
    // populated from the mapped profile at this point).
    user: {
      create: {
        before: async (user) => {
          const login = (user as { githubLogin?: string }).githubLogin;
          const allowed = isLoginAllowed(login, ALLOWED);
          log("user.create.before login=%o allowed=%o allowList=%o", login, allowed, ALLOWED);
          if (!allowed) {
            throw new APIError("FORBIDDEN", { message: "User not allowed" });
          }
          return { data: user };
        },
      },
    },
    // Braces: the authoritative gate. Runs on EVERY sign-in (new and returning),
    // so removing someone from the allow-list locks them out even though their
    // user row already exists. Reads the user via the internal adapter; if that
    // is unavailable it denies (fail-closed).
    session: {
      create: {
        before: async (session, ctx) => {
          const user = await ctx?.context.internalAdapter.findUserById(session.userId);
          const login = (user as { githubLogin?: string } | null | undefined)?.githubLogin;
          const allowed = isLoginAllowed(login, ALLOWED);
          log("session.create.before login=%o allowed=%o allowList=%o", login, allowed, ALLOWED);
          if (!allowed) return false;
          return { data: session };
        },
      },
    },
  },
  // Mandatory for TanStack Start: lets better-auth set cookies through TSS's
  // response pipeline.
  plugins: [tanstackStartCookies()],
});

export type Auth = typeof auth;
