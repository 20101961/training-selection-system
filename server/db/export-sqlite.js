import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from './connection.js';

// 用 VACUUM INTO 产出一份自包含单文件库（折叠 WAL、无 -wal/-shm），
// 供 Navicat / DB Browser 等外部工具干净打开，且不干扰正在运行的 dev 服务。
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', '..', 'exports');
mkdirSync(outDir, { recursive: true });

const out = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(outDir, 'app-navicat.db');
if (existsSync(out)) rmSync(out); // VACUUM INTO 要求目标不存在；副本是我们自己生成的，可安全覆盖

const target = out.replace(/\\/g, '/').replace(/'/g, "''");
db.exec(`VACUUM INTO '${target}'`);

console.log('[db:copy] Navicat 可直接打开的单文件副本 ->', out);
db.close();