// Public surface of the DB adapter. The composition root (#15/#16 wiring) and
// deployment (#17) import from here; nothing reaches into individual modules.

export { DB_PATH, ensureDbDir } from "./db-path";
export type { ProviderAccountRow, SettingRow } from "./entities";
export { ProviderAccount, Setting } from "./entities";
export { DEFAULT_DB_PATH } from "./mikro-orm.config";
export { MikroOrmAccountRepository } from "./mikro-orm-account-repository";
export { initOrm } from "./orm";
