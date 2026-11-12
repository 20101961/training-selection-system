import { Router } from 'express';
import { db } from '../db/connection.js';
import { authenticate, blockUntilPasswordChanged, requireRole } from '../middleware/auth.js';
import { effectiveStageStatus } from '../lib/window.js';
import { logAudit } from '../lib/audit.js';

const router = Router();
router.use(authenticate, blockUntilPasswordChanged);

router.get('/', (_req, res) => {
  const stages = db.prepare('SELECT * FROM stages ORDER BY stage_no').all()
    .map((s) => ({ ...s, effective: effectiveStageStatus(s) }));
  res.json({ stages, serverTime: new Date().toISOString() });
});

// 教务应急提前/延时权 (§7)：强制开合某阶段时间窗，覆盖服务器时钟判定。
router.post('/:id/force', requireRole('academic_affairs'), (req, res) => {
  const { state } = req.body || {};
  if (!['forced_open', 'forced_closed', null].includes(state)) {
    return res.status(400).json({ error: 'state 须为 forced_open / forced_closed / null' });
  }
  const stage = db.prepare('SELECT * FROM stages WHERE id = ?').get(req.params.id);
  if (!stage) return res.status(404).json({ error: '阶段不存在' });

  db.prepare('UPDATE stages SET force_state=?, updated_by=?, updated_at=? WHERE id=?')
    .run(state, req.user.id, new Date().toISOString(), stage.id);
  logAudit({
    actorUserId: req.user.id, actorRole: req.user.role,
    action: state ? `window_${state}` : 'window_auto', entityType: 'stage', entityId: stage.id,
    detail: { stageNo: stage.stage_no, name: stage.name, state },
  });
  const updated = db.prepare('SELECT * FROM stages WHERE id=?').get(stage.id);
  res.json({ stage: { ...updated, effective: effectiveStageStatus(updated) } });
});

export default router;