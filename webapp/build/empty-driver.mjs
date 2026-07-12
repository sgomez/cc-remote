// Build stub for the optional knex SQL dialect drivers we never install.
//
// MikroORM's SQLite driver pulls in knex, and knex statically references every
// dialect's client module (`mysql2`, `oracledb`, `tedious`, ...). Only
// `better-sqlite3` is installed, so the bundler (rolldown, via the Nitro server
// build) cannot resolve the rest and fails the build — the exact reason the
// server composition root deferred wiring the ORM. knex loads a dialect's
// driver lazily and only for the configured client, so for our better-sqlite3
// connection these modules are never required at runtime; aliasing them to this
// empty module makes the graph resolve without changing behaviour.
export default {};
