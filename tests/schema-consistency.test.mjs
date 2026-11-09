import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('shipped migrations match Prisma columns, enum values, defaults and indexes', async () => {
  const generated = execFileSync(process.execPath, [
    'node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-empty',
    '--to-schema-datamodel', 'prisma/schema.prisma', '--script',
  ], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/raw_batch_test',
      PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
  const db = await PGlite.create();
  try {
    await db.exec('CREATE SCHEMA shipped; SET search_path TO shipped, public;');
    const root = new URL('../prisma/migrations/', import.meta.url);
    const migrations = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    for (const migration of migrations) {
      await db.exec(await readFile(new URL(`${migration}/migration.sql`, root), 'utf8'));
    }
    await db.exec('CREATE SCHEMA expected; SET search_path TO expected, public;');
    await db.exec(generated);
    const normalize = (rows) => JSON.parse(JSON.stringify(rows).replaceAll(/(?:shipped|expected)\./g, ''));
    for (const sql of [
      `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default,
        character_maximum_length, datetime_precision FROM information_schema.columns
        WHERE table_schema = $1 ORDER BY table_name, ordinal_position`,
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname`,
      `SELECT t.typname, e.enumlabel, e.enumsortorder FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid JOIN pg_namespace n ON t.typnamespace = n.oid
        WHERE n.nspname = $1 ORDER BY t.typname, e.enumsortorder`,
    ]) {
      const actual = normalize((await db.query(sql, ['shipped'])).rows);
      const expected = normalize((await db.query(sql, ['expected'])).rows);
      assert.deepEqual(actual, expected);
    }
  } finally {
    await db.close();
  }
});
