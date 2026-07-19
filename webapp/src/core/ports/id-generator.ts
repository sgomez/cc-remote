// IdGenerator — source of unique ids: Account ids (which also name the config
// volume), Session UUIDs (SESSION_UUID, for remote-control pairing), and
// broker secrets (per-Session credential the broker verifies).

export interface IdGenerator {
  newId(): string;
  /** A cryptographically random secret for the Session broker. */
  newSecret(): string;
}
