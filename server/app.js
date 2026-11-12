import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from './db/connection.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import baseDataRoutes from './routes/baseData.js';
import stagesRoutes from './routes/stages.js';
import flowRoutes from './routes/flow.js';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '..', 'dist');

export function createApp() {
  const app = express();
  app.use(cors());
  // 附件上传走 base64 JSON（5MB 文件 ≈ 7MB 编码），仅该路径放宽上限，其余接口保持默认 100kb。
  app.use('/api/flow/attachments', express.json({ limit: '12mb' }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    const ok = db.prepare('SELECT COUNT(*) c FROM users').get().c >= 0;
    res.json({ ok, service: 'lab-selection-system', serverTime: new Date().toISOString(), db: ok ? 'up' : 'down' });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/base', baseDataRoutes);
  app.use('/api/stages', stagesRoutes);
  app.use('/api/flow', flowRoutes);

  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));

  // 生产模式：服务前端构建产物 + SPA fallback。
  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => res.sendFile(join(distDir, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    console.error('[server:error]', err);
    res.status(500).json({ error: '服务器内部错误', detail: String(err?.message || err) });
  });

  return app;
}