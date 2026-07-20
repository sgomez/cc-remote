// Serializable view rows crossing the server-function boundary (#16). Pure
// types (no runtime, no server imports) so both the server glue and the client
// components import them freely. The catalogue label/capabilities are looked up
// client-side from the (client-safe) Provider Type catalogue by `providerType`.

import type { AccountStatus, PermissionMode, SessionStatus } from "~/core";

export type SessionRow = {
  name: string;
  repo: string;
  accountId: string;
  status: SessionStatus;
  /** `null` for a Session created before the mode was recorded on its label. */
  permissionMode: PermissionMode | null;
};

export type AccountRow = {
  id: string;
  providerType: string;
  displayName: string;
  status: AccountStatus;
  /** Number of Sessions labelled with this Account (Docker is source of truth). */
  sessionsInUse: number;
};

export type AccountDetail = AccountRow & {
  /** `cc-remote-account-<id>` — every Account owns one. */
  configVolume: string;
  config: Record<string, string>;
  sessions: SessionRow[];
};
