import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
export function sqliteD1(until = '9999') {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const f of readdirSync('migrations').filter(f => f.endsWith('.sql') && f.slice(0, 4) <= until).sort()) sqlite.exec(readFileSync('migrations/' + f, 'utf8'));
  function prepared(sql: string, params: SQLInputValue[] = []): Record<string, unknown> {
    const stmt = sqlite.prepare(sql);
    return {
      bind: (...values: SQLInputValue[]) => prepared(sql, values),
      first: async (column?: string) => { const row = stmt.get(...params); return column ? row?.[column] ?? null : row ?? null; },
      all: async () => ({ success: true, results: stmt.all(...params), meta: { changes: 0 } }),
      run: async () => { const r = stmt.run(...params); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    };
  }
  const db = {
    prepare: (sql: string) => prepared(sql),
    batch: async (statements: Array<{ run: () => Promise<unknown> }>) => {
      sqlite.exec('BEGIN');
      try { const results = []; for (const s of statements) results.push(await s.run()); sqlite.exec('COMMIT'); return results; }
      catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  } as unknown as D1Database;
  return { db, sqlite, migrate: (file: string) => sqlite.exec(readFileSync(file, 'utf8')) };
}
