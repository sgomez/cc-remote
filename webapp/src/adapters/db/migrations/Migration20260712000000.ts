// Initial MikroORM migration: the domain tables (PRD §3). DDL matches the
// EntitySchema definitions in ../entities.ts (kept in sync via
// `pnpm db:migrate:create` when entities change). better-auth's tables are NOT
// here — they are owned by `@better-auth/cli migrate` on the same SQLite file.

import { Migration } from "@mikro-orm/migrations";

export class Migration20260712000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      "create table `provider_account` (`id` text not null, `provider_type` text not null, `display_name` text not null, `credentials` json not null, `config` json not null, `status` text not null, `created_at` text not null, primary key (`id`));",
    );
    this.addSql(
      "create table `setting` (`key` text not null, `value` text not null, primary key (`key`));",
    );
  }

  override async down(): Promise<void> {
    this.addSql("drop table if exists `provider_account`;");
    this.addSql("drop table if exists `setting`;");
  }
}
