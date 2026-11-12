import { createApp } from './app.js';
import { db } from './db/connection.js';
import { effectiveStageStatus } from './lib/window.js';

const PORT = process.env.PORT || 8787;

// 定时任务自动开合时间窗 (§7)：按服务器时钟同步 stages.status (教务 force_state 优先)。
function syncStageWindows() {
  const stages = db.prepare('SELECT * FROM stages').all();
  const upd = db.prepare('UPDATE stages SET status=? WHERE id=? AND status<>?');
  for (const s of stages) {
    const eff = effectiveStageStatus(s);
    const persisted = s.force_state ? (s.force_state === 'forced_open' ? 'open' : 'closed') : eff;
    upd.run(persisted, s.id, persisted);
  }
}
syncStageWindows();
const ticker = setInterval(syncStageWindows, 30_000);

const app = createApp();
const server = app.listen(PORT, () => {
  console.log(`[server] API listening on http://localhost:${PORT}`);
  console.log(`[server] health: http://localhost:${PORT}/api/health`);
});

function shutdown() {
  clearInterval(ticker);
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);