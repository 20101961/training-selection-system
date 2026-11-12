import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, dbPath } from './connection.js';

// 读取当前 SQLite 库的建表(MySQL 版) + 全量数据, 生成可直接导入 MySQL 的 database-mysql.sql。
const here = dirname(fileURLToPath(import.meta.url));
const ddl = readFileSync(join(here, 'schema-mysql.sql'), 'utf8');
const outPath = process.argv[2]
  ? join(process.cwd(), process.argv[2])
  : join(here, '..', '..', 'exports', 'database-mysql.sql');

// 父表在前 (FK 友好); 数据导入时已临时关闭外键检查, 顺序仅为可读。
const TABLES = [
  'labs', 'mentors', 'mentor_quotas', 'students', 'users', 'sessions', 'rounds', 'stages',
  'applications', 'application_choices', 'interview_scores', 'candidate_lists', 'placements',
  'publications', 'appeals', 'audit_logs', 'notices', 'import_batches', 'application_attachments',
];

// ISO8601 (含 Z) -> MySQL DATETIME; 布尔/数字原样; 字符串转义。
function mysqlLit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return Number.isFinite(Number(v)) ? String(v) : 'NULL';
  if (Buffer.isBuffer(v)) return '0x' + v.toString('hex').toUpperCase();
  if (v instanceof Uint8Array) return '0x' + Buffer.from(v).toString('hex').toUpperCase();
  let s = String(v);
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d{1,6})?Z$/.exec(s);
  if (m) s = m[1] + ' ' + m[2] + (m[3] || '');
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

const parts = [
  ddl.trimEnd(),
  '',
  '-- ==== 数据 (源: ' + dbPath + ' · 导出于 ' + new Date().toISOString() + ') ====',
  'SET FOREIGN_KEY_CHECKS = 0;',
  '',
];

let rowCount = 0;
for (const t of TABLES) {
  const rows = db.prepare('SELECT * FROM `' + t + '`').all();
  if (rows.length === 0) { parts.push('-- ' + t + ': 0 行', ''); continue; }
  const cols = Object.keys(rows[0]).map((c) => '`' + c + '`').join(', ');
  const values = rows.map((r) => '(' + Object.values(r).map(mysqlLit).join(', ') + ')').join(',\n');
  parts.push('-- ' + t + ': ' + rows.length + ' 行');
  parts.push('INSERT INTO `' + t + '` (' + cols + ') VALUES');
  parts.push(values + ';');
  parts.push('');
  rowCount += rows.length;
}

parts.push('SET FOREIGN_KEY_CHECKS = 1;');
writeFileSync(outPath, parts.join('\n') + '\n', 'utf8');

console.log('[db:dump-mysql] 已生成 -> ' + outPath);
console.log('[db:dump-mysql] ' + TABLES.length + ' 张表 · ' + rowCount + ' 行数据');
db.close();