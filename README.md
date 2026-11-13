# 学生实训室进组选拔填报系统

半自动选拔流程单页应用（需求规格 v1.1）。前端面向学生 / 导师 / 实训室负责人，后端含教务管理后台，前后端分离、共享 SPA 架构。系统从第 3 步「意向填报」开始管理，覆盖填报 → 初选面试 → 确认 → 补录 → 统筹调剂 → 公示入组共 8 个阶段。

## 目录结构（前后端分离）

| 目录 / 文件 | 角色 | 说明 |
|---|---|---|
| `web/` | **前端** | Vite + React 18 + TypeScript + React Router，PC 端 SPA |
| `server/` | **后端** | Node ESM + Express + 内置 `node:sqlite`，对外提供 `/api` |
| `server/routes/` | 后端 | 接口路由（auth / dashboard / base / stages / flow） |
| `server/lib/` | 后端 | 业务逻辑（名额并发锁、审计、时间窗、口令哈希） |
| `server/db/` | 后端 | schema、seed、dump、export 脚本 |
| `server/data/` | 数据库 | 实时 SQLite 库 `app.db`（WAL）——**已 gitignore，不入库** |
| `dist/` | 构建产物 | `npm run build` 输出，生产模式由后端托管（gitignore） |
| `docs/` | 文档 | `需求设定-v1.1.md` + `samples/` 演示样例 |
| `exports/` | 数据导出 | 库导出 / 备份——**含真实数据，已 gitignore，不入库** |
| `vite.config.ts` | 配置 | 前端根目录 `web/`，开发代理 `/api` → `:8787` |
| `tsconfig.json` | 配置 | TypeScript（include `web/src`） |

前后端通过 `/api` 通信：开发时 Vite(`:5173`) 把 `/api` 代理到后端(`:8787`)；生产时后端单端口(`:8787`)同时托管 `dist/` 页面与接口。

## 环境要求

- **Node.js ≥ 22.5**（用到内置 `node:sqlite`，无需原生编译依赖）

## 启动

```bash
npm install

# 开发模式：后端 :8787 + 前端 :5173（热更新）
npm run dev

# 生产模式：先构建，再单端口 :8787 托管页面 + 接口
npm run build
npm start
```

- 开发访问：http://localhost:5173
- 生产 / 本机访问：http://localhost:8787
- 局域网他人访问（生产模式）：`http://<本机IP>:8787`（需同一网段，并在防火墙放行该端口）

## 数据库脚本

| 命令 | 作用 |
|---|---|
| `npm run db:init` | 建表（schema 幂等，服务启动时也会自动应用） |
| `npm run db:seed` | 写入演示数据（2 实训室 / 4 导师 / 8 学生 / 角色账号 / 时间窗） |
| `npm run db:dump` | 导出 SQLite 全量 → `exports/database.sql` |
| `npm run db:dump-mysql` | 导出 MySQL 版 → `exports/database-mysql.sql` |
| `npm run db:copy` | 生成 Navicat / DB Browser 可开的单文件副本 → `exports/app-navicat.db` |
| `npm run typecheck` | TypeScript 类型检查 |

## 演示账号

种子数据提供 4 类角色账号，**初始口令均为 `123456`，首次登录强制改密**：

| 角色 | 账号 |
|---|---|
| 教务 | `admin` |
| 导师 | `M001` / `M002` / `M003` |
| 实训室负责人 | `H001` / `H002` |
| 学生 | `2024001` / `2024002` / `2024003` / `2024005` |

> 仅为演示。正式使用前务必修改默认口令；真实学生 / 导师 / 名额数据由教务 Excel 批量导入，账号绑定学号、首次登录强制改密。

## 数据安全

实时库与所有数据导出（`server/data/`、`exports/`）均已 `.gitignore`，**仓库只含源码与文档，不含任何真实数据 / 口令哈希**。需求细节见 `docs/需求设定-v1.1.md`。