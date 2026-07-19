// BrokerSecretRegistry — the in-memory store of per-Session broker secrets.
// Registered at Session provision time and validated by the broker endpoint.
// The broker rejects any secret it does not recognise; the reason is never
// disclosed to the caller (unknown/mismatched all look the same).

export type BrokerSecretEntry = {
  sessionName: string;
  repo: string;
};

export interface BrokerSecretRegistry {
  /** Record a new broker secret for a Session. */
  register(secret: string, sessionName: string, repo: string): void;
  /** Look up a Session by its broker secret; returns null if unknown. */
  lookup(secret: string): BrokerSecretEntry | null;
}
