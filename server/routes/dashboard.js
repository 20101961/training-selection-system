import { Router } from 'express';
import { db } from '../db/connection.js';
import { authenticate, blockUntilPasswordChanged } from '../middleware/auth.js';
import { effectiveStageStatus, currentStage } from '../lib/window.js';

const router = Router();
router.use(authenticate, blockUntilPasswordChanged);

const count = (sql) => db.prepare(sql).get().c;

router.get('/', (req, res) => {
  const stages = db.prepare('SELECT * FROM stages ORDER BY stage_no').all()
    .map((s) => ({ ...s, effective: effectiveStageStatus(s) }));
  const cur = currentStage(stages);

  const labs = db.prepare('SELECT * FROM labs ORDER BY id').all();
  const mentors = db.prepare(
    `SELECT m.*, l.name AS lab_name, COALESCE(q.quota,0) AS quota
     FROM mentors m JOIN labs l ON l.id=m.lab_id
     LEFT JOIN mentor_quotas q ON q.mentor_id=m.id ORDER BY m.id`
  ).all();

  // 每导师已确认占用 (确认即锁定) → 剩余名额。
  const occupied = db.prepare(
    "SELECT mentor_id, COUNT(*) c FROM placements WHERE status='confirmed' GROUP BY mentor_id"
  ).all();
  const occMap = Object.fromEntries(occupied.map((r) => [r.mentor_id, r.c]));
  const mentorStats = mentors.map((m) => ({
    ...m,
    confirmed: occMap[m.id] || 0,
    remaining: Math.max(0, m.quota - (occMap[m.id] || 0)),
  }));

  res.json({
    serverTime: new Date().toISOString(),
    counts: {
      labs: labs.length,
      mentors: mentors.length,
      students: count('SELECT COUNT(*) c FROM students'),
      totalQuota: db.prepare('SELECT COALESCE(SUM(quota),0) q FROM mentor_quotas').get().q,
      applicationsSubmitted: count("SELECT COUNT(*) c FROM applications WHERE status='submitted'"),
      pendingConfirm: count("SELECT COUNT(*) c FROM placements WHERE status='pending'"),
      confirmed: count("SELECT COUNT(*) c FROM placements WHERE status='confirmed'"),
      formal: count("SELECT COUNT(*) c FROM students WHERE status='formal'"),
      failed: count("SELECT COUNT(*) c FROM students WHERE status='failed'"),
    },
    currentStage: cur ? { stageNo: cur.stage_no, name: cur.name, code: cur.code, effective: cur.effective, opensAt: cur.opens_at, closesAt: cur.closes_at } : null,
    stages,
    rounds: db.prepare('SELECT * FROM rounds ORDER BY round_no').all(),
    labs,
    mentors: mentorStats,
    recentAudit: db.prepare('SELECT id,actor_role,action,entity_type,created_at FROM audit_logs ORDER BY id DESC LIMIT 8').all(),
    notices: db.prepare(
      `SELECT id,title,body,level,read_at,created_at FROM notices
       WHERE user_id = ? OR role_target = ? OR (user_id IS NULL AND role_target IS NULL)
       ORDER BY id DESC LIMIT 10`
    ).all(req.user.id, req.user.role),
  });
});

const dayKey = (iso) => (iso ? String(iso).slice(0, 10) : null);

// 图表统计：近 7 日趋势（折线）+ 学生状态分布（饼图）。以服务器 UTC 时钟分日。
router.get('/trends', (_req, res) => {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const bucket = (rows, field) => {
    const m = Object.fromEntries(days.map((k) => [k, 0]));
    for (const r of rows) { const k = dayKey(r[field]); if (k && k in m) m[k] += 1; }
    return days.map((date) => ({ date, count: m[date] }));
  };

  const submitted = bucket(
    db.prepare("SELECT submitted_at FROM applications WHERE status IN ('submitted','returned') AND submitted_at IS NOT NULL").all(),
    'submitted_at',
  );
  const confirmed = bucket(
    db.prepare("SELECT confirmed_at FROM placements WHERE status='confirmed' AND confirmed_at IS NOT NULL").all(),
    'confirmed_at',
  );

  const studentCount = (sql) => db.prepare(sql).get().c;
  const statusPie = [
    { key: 'formal', name: '正式入组', count: studentCount("SELECT COUNT(*) c FROM students WHERE status='formal'") },
    { key: 'confirmed', name: '已确认', count: studentCount("SELECT COUNT(*) c FROM students WHERE status='confirmed'") },
    { key: 'enrolled', name: '已报到', count: studentCount("SELECT COUNT(*) c FROM students WHERE status='enrolled'") },
    { key: 'published', name: '公示中', count: studentCount("SELECT COUNT(*) c FROM students WHERE status='published'") },
    { key: 'in_flow', name: '流程中', count: studentCount(
      `SELECT COUNT(*) c FROM students WHERE status IN
       ('pending_fill','filled','interviewed','provisional','pending_confirm','supplementary','coordination')`) },
    { key: 'unadmitted', name: '未录取', count: studentCount("SELECT COUNT(*) c FROM students WHERE status IN ('unadmitted','failed')") },
  ];

  res.json({ days, submitted, confirmed, statusPie });
});

export default router;