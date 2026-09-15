// Apply sql/schema.sql to the Supabase project.
//
// Runtime talks to Supabase over the REST API (supabase-js), but DDL needs a
// real Postgres connection, so this script connects through the session-mode
// pooler. New projects have no `db.<ref>.supabase.co` host — the pooler region
// is discovered automatically the first time and cached in .env.
//
//   npm run supabase:setup            apply schema
//   npm run supabase:setup -- --check verify tables exist, change nothing

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const checkOnly = process.argv.includes('--check');

const ref = (config.supabase.url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
if (!ref) {
  console.error('SUPABASE_URL is not set or is malformed in server/.env');
  process.exit(1);
}
const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error('SUPABASE_DB_PASSWORD is not set in server/.env');
  process.exit(1);
}

const REGIONS = [
  process.env.SUPABASE_REGION,
  'ap-northeast-1', 'us-east-1', 'us-west-1', 'eu-central-1', 'eu-west-2',
  'ap-southeast-1', 'ap-south-1', 'us-east-2', 'sa-east-1', 'ca-central-1',
].filter(Boolean);

async function connect() {
  let lastErr;
  for (const region of REGIONS) {
    const client = new pg.Client({
      host: `aws-0-${region}.pooler.supabase.com`,
      port: 5432,
      user: `postgres.${ref}`,
      password,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 9000,
    });
    try {
      await client.connect();
      console.log(`connected via ${region}`);
      // Cache the region so later runs don't probe every one.
      const envPath = path.resolve(__dirname, '../.env');
      const env = fs.readFileSync(envPath, 'utf8');
      if (!/^SUPABASE_REGION=/m.test(env)) {
        fs.writeFileSync(envPath, `${env.replace(/\n*$/, '\n')}SUPABASE_REGION=${region}\n`);
      }
      return client;
    } catch (err) {
      lastErr = err;
      try { await client.end(); } catch {}
    }
  }
  throw lastErr || new Error('no pooler region accepted the connection');
}

const client = await connect();

try {
  if (checkOnly) {
    const { rows } = await client.query(`
      select table_name, (select count(*) from information_schema.columns c
                          where c.table_name = t.table_name and c.table_schema='public') as cols
      from information_schema.tables t
      where table_schema = 'public' order by table_name
    `);
    console.log('\npublic tables:');
    if (!rows.length) console.log('  (none — run without --check to create them)');
    for (const r of rows) console.log(`  ${r.table_name.padEnd(12)} ${r.cols} columns`);

    for (const t of ['ads', 'seen_ads', 'runs']) {
      try {
        const { rows: c } = await client.query(`select count(*)::int n from public.${t}`);
        console.log(`  ${t} rows: ${c[0].n}`);
      } catch { /* table absent */ }
    }
  } else {
    const sql = fs.readFileSync(path.resolve(__dirname, '../sql/schema.sql'), 'utf8');
    await client.query(sql);
    console.log('schema applied');
    const { rows } = await client.query(`
      select table_name from information_schema.tables
      where table_schema='public' order by table_name
    `);
    console.log('tables now:', rows.map((r) => r.table_name).join(', '));
  }
} finally {
  await client.end();
}
