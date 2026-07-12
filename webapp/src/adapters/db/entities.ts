// MikroORM domain tables (PRD §3). EntitySchema (not decorators) keeps the
// adapter free of `reflect-metadata` / `experimentalDecorators`, matching the
// repo's plain tsconfig. camelCase properties map to snake_case columns.

import { EntitySchema } from "@mikro-orm/core";

/**
 * `provider_account` row. `credentials` and `config` are plaintext JSON by
 * decision (#5); `createdAt` is stored as an ISO-8601 string so millisecond
 * precision round-trips exactly (SQLite has no native Date type).
 */
export interface ProviderAccountRow {
  id: string;
  providerType: string;
  displayName: string;
  credentials: Record<string, string>;
  config: Record<string, string>;
  status: string;
  createdAt: string;
}

/** `setting` key-value row for app preferences. */
export interface SettingRow {
  key: string;
  value: string;
}

export const ProviderAccount = new EntitySchema<ProviderAccountRow>({
  name: "ProviderAccount",
  tableName: "provider_account",
  properties: {
    id: { type: "string", primary: true },
    providerType: { type: "string", fieldName: "provider_type" },
    displayName: { type: "string", fieldName: "display_name" },
    credentials: { type: "json" },
    config: { type: "json" },
    status: { type: "string" },
    createdAt: { type: "string", fieldName: "created_at" },
  },
});

export const Setting = new EntitySchema<SettingRow>({
  name: "Setting",
  tableName: "setting",
  properties: {
    key: { type: "string", primary: true },
    value: { type: "string" },
  },
});
