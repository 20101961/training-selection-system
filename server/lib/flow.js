import { db, nowIso } from '../db/connection.js';
import { effectiveStageStatus } from './window.js';
import { logAudit } from './audit.js';

export class FlowError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

const DAY = 24 * 3600 * 1000;

// ── 阶段 / 轮次 ────────────────────────────────────────────────
export function stageRow(stageNo) {
  const s = db.prepare('SELECT * FROM stages WHERE stage_no = ?').get(stageNo);
  if (!s) throw new FlowError(500, `阶段 ${stageNo} 未配置`);
  return { ...s, effective: effectiveStageStatus(s) };
}

export function stageInfo(stageNo) {
  const s = stageRow(stageNo);
  return { stageNo: s.stage_no, code: s.code, name: s.name, effective: s.effective, opensAt: s.opens_at, closesAt: s.closes_at };
}

// 时间窗闸门：仅开放期可提交；教务的应急与收尾动作不受窗口限制。
export function requireStageOpen(stageNo, user) {
  const s = stageRow(stageNo);
  if (s.effective === 'open') return s;
  if (user?.role === 'academic_affairs') return s;
  const why = s.effective === 'pending' ? '尚未开放' : '已关闭';
  throw new FlowError(409, `「${s.name}」窗口${why}（${s.opens_at} → ${s.closes_at}），以服务器时间为准`);
}

export function roundOf(roundNo) {
  const r = db.prepare('SELECT * FROM rounds WHERE round_no = ?').get(roundNo);
  if (!r) throw new FlowError(500, `轮次 ${roundNo} 不存在`);
  return r;
}

// 学生当前所在轮：已提交过 initial 轮 → 之后走补录轮 (取最新的 open 补录轮，否则 round 1)。
export function currentRoundFor(studentId) {
  const opened = db.prepare("SELECT * FROM rounds WHERE status='open' AND type='supplementary' ORDER BY round_no DESC").all();
  if (opened.length > 0) return opened[0];
  return roundOf(1);
}

// ── 名额 / 去向 ────────────────────────────────────────────────
export function quotaOf(mentorId) {
  return db.prepare('SELECT COALESCE(quota,0) q FROM mentor_quotas WHERE mentor_id=?').get(mentorId)?.q ?? 0;
}
export function confirmedCount(mentorId) {
  return db.prepare("SELECT COUNT(*) c FROM placements WHERE mentor_id=? AND status='confirmed'").get(mentorId).c;
}
export function remainingOf(mentorId) {
  return Math.max(0, quotaOf(mentorId) - confirmedCount(mentorId));
}

export function studentOf(user) {
  if (!user.student_id) throw new FlowError(403, '该账号未绑定学生');
  const s = db.prepare('SELECT * FROM students WHERE id=?').get(user.student_id);
  if (!s) throw new FlowError(403, '学生档案不存在');
  return s;
}
export function mentorOf(user) {
  if (!user.mentor_id) throw new FlowError(403, '该账号未绑定导师');
  const m = db.prepare('SELECT * FROM mentors WHERE id=?').get(user.mentor_id);
  if (!m) throw new FlowError(403, '导师档案不存在');
  return m;
}

export function setStudentStatus(studentId, status) {
  db.prepare('UPDATE students SET status=?, updated_at=? WHERE id=?').run(status, nowIso(), studentId);
}

export function confirmedPlacement(studentId) {
  return db.prepare("SELECT * FROM placements WHERE student_id=? AND status='confirmed'").get(studentId);
}

export function hasAnyPlacement(studentId) {
  return db.prepare("SELECT id FROM placements WHERE student_id=? AND status IN ('pending','confirmed')").get(studentId);
}

// ── 递补 (§5.4)：空位按导师预排顺序顺延，跳过已入组者，被顶上者仍须确认 ──
export function promoteWaitlist(mentorId) {
  const rows = db
    .prepare("SELECT * FROM candidate_lists WHERE mentor_id=? AND category='waitlist' AND status='active' ORDER BY waitlist_rank")
    .all(mentorId);
  for (const c of rows) {
    if (confirmedPlacement(c.student_id)) continue; // 已在他处确认入组 → 跳过；仅待确认者仍可被递补并自行选唯一
    db.prepare("UPDATE candidate_lists SET status='promoted' WHERE id=?").run(c.id);
    const p = db
      .prepare("INSERT INTO placements(student_id,round_id,mentor_id,lab_id,source,candidate_id,status) VALUES(?,?,?,?, 'waitlist_promote',?,'pending')")
      .run(c.student_id, c.round_id, mentorId, mentorLabId(mentorId), c.id);
    setStudentStatus(c.student_id, 'pending_confirm');
    notifyUser(c.student_id, '递补通知：请确认去向', '你已被递补进入拟录取名单，请在确认窗口内确认唯一去向。', 'action');
    logAudit({ actorRole: 'system', action: 'promote_waitlist', entityType: 'placement', entityId: Number(p.lastInsertRowid), studentId: c.student_id, roundId: c.round_id, detail: { mentor_id: mentorId, rank: c.waitlist_rank } });
    return c.student_id;
  }
  return null; // 名单抽干 → 交由人工裁决
}

export function mentorLabId(mentorId) {
  return db.prepare('SELECT lab_id FROM mentors WHERE id=?').get(mentorId)?.lab_id ?? null;
}

// ── 站内提示 ───────────────────────────────────────────────────
export function notifyUser(studentId, title, body, level = 'info') {
  const user = db.prepare("SELECT id FROM users WHERE role='student' AND student_id=?").get(studentId);
  db.prepare('INSERT INTO notices(user_id,role_target,title,body,level) VALUES(?,NULL,?,?,?)')
    .run(user?.id ?? null, title, body, level);
}
export function notifyRole(role, title, body, level = 'warn') {
  db.prepare('INSERT INTO notices(user_id,role_target,title,body,level) VALUES(NULL,?,?,?,?)').run(role, title, body, level);
}

// ── 公示生效 (§5.8)：满 1 天无异议自动入组 ──────────────────────
export function settlePublications() {
  const due = db.prepare("SELECT * FROM publications WHERE status='published' AND effective_at <= ?").all(nowIso());
  for (const p of due) {
    db.prepare("UPDATE publications SET status='effective' WHERE id=?").run(p.id);
    setStudentStatus(p.student_id, 'formal');
    logAudit({ actorRole: 'system', action: 'publication_effective', entityType: 'publication', entityId: p.id, studentId: p.student_id, detail: { effective_at: p.effective_at } });
  }
  return due.length;
}

export const publishEffectiveAt = () => new Date(Date.now() + DAY).toISOString();
