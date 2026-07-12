// better-auth browser client (#16). Used by the login screen to start the GitHub
// social sign-in and by the app chrome to sign out. Client-safe: it only talks
// to the /api/auth/* endpoints over HTTP — no server secrets are imported here.

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

export function signInWithGithub(callbackURL = "/sessions") {
  return authClient.signIn.social({ provider: "github", callbackURL });
}

export function signOut() {
  return authClient.signOut();
}
