// Drop the `claude-local` Provider Type. It was the only host-mount Seeding
// Method: its Account bind-mounted the host's ~/.claude instead of owning an
// Account Config Volume, which forced CLAUDE_CONFIG_PATH/CLAUDE_JSON_PATH into
// the deployment config and made entrypoint.sh chown across a host bind mount on
// every start. The OAuth Login Container gives the same "log in as me" outcome
// with no host coupling, so the type is gone from the catalogue.
//
// A row left behind would break the accounts UI: `requireProviderType` throws
// UnknownProviderTypeError for an id no longer in the catalogue. Sessions are
// labelled Docker containers with no DB rows, so nothing here cascades — but a
// still-running claude-local Session keeps its (now orphaned) account id label
// until it is destroyed. Deleting the account row is deliberately blocked in the
// app while Sessions use it; this migration is the one place that bypasses that
// guard, because the type itself no longer exists to run Sessions on.

import { Migration } from "@mikro-orm/migrations";

export class Migration20260712130000 extends Migration {
  override async up(): Promise<void> {
    this.addSql("delete from `provider_account` where `provider_type` = 'claude-local';");
  }

  override async down(): Promise<void> {
    // Irreversible: the Account's identity lived in the host's ~/.claude, which
    // this migration never touched, but the row itself cannot be reconstructed.
  }
}
