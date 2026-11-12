import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH || join(dataDir, 'app.db');

export const db = new DatabaseSync(dbPath);

// WAL 允许并发读；busy_timeout 让写锁竞争等待而非立即报错。
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

// schema.sql 全部为 IF NOT EXISTS，启动时幂等应用：新表自动补建到已有库，无需手动跑 db:init。
db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));

// 确认瞬间并发锁的核心：BEGIN IMMEDIATE 立即取写锁，串行化"校验名额→写去向"。
// node:sqlite 同步执行 + SQLite 单写者模型 => 先到先得，后到者拿到"名额已满"。
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export { dbPath };