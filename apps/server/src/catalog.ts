import { withSshTunnel } from './ssh-tunnel.js';
import { postgresTls, mysqlTlsOptions } from './tls-options.js';
import Database from '../../../packages/storage/src/native-database.mjs';
import type { SavedConnection } from '../../../packages/storage/src/connections.js';
import { createPostgresClient, createMysqlClient, mysqlValueOptions } from './driver-values.js';
import mysql from 'mysql2/promise';

type TableName = { schema: string; name: string };
export const CATALOG_PAGE_SIZE = 200;
// Metadata uses keyset pagination; it is not a data-query result snapshot.
export async function listTablePage(profile: SavedConnection, after?: TableName): Promise<TableName[]> { return withSshTunnel(profile, effective => listTablePageDirect(effective, after)); }
async function listTablePageDirect(profile: SavedConnection, after?: TableName): Promise<TableName[]> {
  if (profile.engine === 'sqlite') {
    const db = new Database(profile.filename, { readonly: true, fileMustExist: true });
    try { return (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name > ? ORDER BY name LIMIT ?").all(after?.name ?? '', CATALOG_PAGE_SIZE + 1) as { name: string }[]).map(row => ({ schema: 'main', name: row.name })); }
    finally { db.close(); }
  }
  if (profile.engine === 'postgres') {
    const client = createPostgresClient({ host: profile.host, port: profile.port, database: profile.database, user: profile.user, password: profile.password, ssl: postgresTls(profile), connectionTimeoutMillis: 5000, query_timeout: 15000 });
    try {
      await client.connect();
      return (await client.query(`SELECT table_schema AS schema, table_name AS name FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog','information_schema')
        AND (table_schema::text COLLATE "C", table_name::text COLLATE "C") > ($1::text COLLATE "C", $2::text COLLATE "C")
        ORDER BY table_schema::text COLLATE "C", table_name::text COLLATE "C" LIMIT $3`, [after?.schema ?? '', after?.name ?? '', CATALOG_PAGE_SIZE + 1])).rows;
    } finally { await client.end().catch(() => {}); }
  }
  const client = await createMysqlClient({ ...mysqlValueOptions, host: profile.host, port: profile.port, database: profile.database, user: profile.user, password: profile.password, ...mysqlTlsOptions(profile), connectTimeout: 5000 });
  try {
    const [rows] = await client.query({ sql: 'SELECT TABLE_SCHEMA AS `schema`, TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND BINARY TABLE_NAME > BINARY ? ORDER BY BINARY TABLE_NAME LIMIT ?', timeout: 15000 }, [profile.database, after?.name ?? '', CATALOG_PAGE_SIZE + 1]);
    return rows as TableName[];
  } finally { await client.end(); }
}
