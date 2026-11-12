import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, dbPath } from './connection.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = process.argv[2]
  ? join(process.cwd(), process.argv[2])
  : join(here, '..', '..', 'exports', 'database.sql');

const id = (s) => `"${String(s).replace(/"/g, '""')}"`;

function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'bigint' || typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (Buffer.isBuffer(v)) return `X'${v.toString('hex')}'`;
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString('hex')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

const objects = (type, extra = '') =>
  db.prepare(
    `SELECT name, sql FROM sqlite_master WHERE type=? AND name NOT LIKE 'sqlite_%' ${extra} ORDER BY rowid`
  ).all(type);

const lines = [];
lines.push(`-- 由 server/db/dump.js 导出 · ${new Date().toISOString()}`);
lines.push(`-- 源库: ${dbPath}`);
lines.push(`-- 内容: 建表/索引/触发器 DDL + 全量数据。可在 DB Browser / sqlite3 / 本项目直接导入。`);
lines.push('');
lines.push('PRAGMA foreign_keys=OFF;');
lines.push('BEGIN TRANSACTION;');
lines.push('');

for (const t of objects('table')) {
  lines.push(`-- 表 ${t.name}`);
  lines.push(`${t.sql};`);
  const rows = db.prepare(`SELECT * FROM ${id(t.name)}`).all();
  if (rows.length) {
    const cols = Object.keys(rows[0]).map(id).join(', ');
    for (const row of rows) {
      const vals = Object.values(row).map(lit).join(', ');
      lines.push(`INSERT INTO ${id(t.name)} (${cols}) VALUES (${vals});`);
    }
  } else {
    lines.push(`-- (${t.name}: 0 行)`);
  }
  lines.push('');
}

lines.push('-- 索引 / 唯一索引');
for (const o of objects('index')) lines.push(`${o.sql};`);
lines.push('');
lines.push('-- 触发器');
for (const o of objects('trigger')) lines.push(`${o.sql};`);
lines.push('');
lines.push('COMMIT;');
lines.push('PRAGMA foreign_keys=ON;');

writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');

const tableCount = objects('table').length;
const rowCount = objects('table').reduce((n, t) => n + db.prepare(`SELECT COUNT(*) c FROM ${id(t.name)}`).get().c, 0);
console.log(`[db:dump] 已导出 -> ${outPath}`);
console.log(`[db:dump] ${tableCount} 张表 · 共 ${rowCount} 行数据`);
db.close();