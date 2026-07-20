// SettingRepository — persistence for Deployment Settings, the preferences an
// operator changes from the browser rather than by rerunning the installer.
//
// Deliberately a bare key/value store: the domain owns which keys exist, what
// they mean, and what an absent key resolves to. Nothing in the environment
// supplies or overrides a Deployment Setting, so this is the single source and
// there is no precedence question to answer.

export interface SettingRepository {
  /** `null` when the key was never written — the caller applies the default. */
  get(key: string): Promise<string | null>;
  /** Writes or overwrites. */
  set(key: string, value: string): Promise<void>;
}
