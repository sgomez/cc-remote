// Placeholder domain module. Framework-free, 100% test-driven — proves the
// Vitest red-green loop the real `core/` work (Provider Type, Account, Session;
// issue #11) will use. Replace when that domain lands.

export const appName = "cc-remote";

/**
 * Normalises a free-form label into a Docker-safe identifier fragment:
 * lowercase, non-alphanumerics collapsed to single dashes, trimmed.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
