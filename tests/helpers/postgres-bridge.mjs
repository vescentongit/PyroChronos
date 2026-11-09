// Test-only SQL wire bridge: execute production Python repository queries on
// PostgreSQL WASM, with the same shipped migrations used by the B1 test suite.
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
const db = await PGlite.create();
const root = new URL('../../', import.meta.url);
const migrations = new URL('prisma/migrations/', root);
const directories = (await readdir(migrations, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
for (const directory of directories) {
  await db.exec(await readFile(new URL(`${directory}/migration.sql`, migrations), 'utf8'));
}
console.log(JSON.stringify({ ready: true }));
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const { sql, params } = JSON.parse(line);
    const result = await db.query(sql, params);
    console.log(JSON.stringify({ rows: result.rows }, (_, value) => typeof value === 'bigint' ? value.toString() : value));
  } catch (error) {
    console.log(JSON.stringify({ errorCode: error.code || 'DATABASE_FAILED' }));
  }
}
await db.close();
