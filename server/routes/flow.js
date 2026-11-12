import { Router } from 'express';
import { db, nowIso, tx } from '../db/connection.js';
import { authenticate, blockUntilPasswordChanged, requireRole } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';
import {
  FlowError, stageInfo, stageRow, requireStageOpen, roundOf, currentRoundFor,
  quotaOf, confirmedCount, remainingOf, studentOf, mentorOf, setStudentStatus,
  confirmedPlacement, hasAnyPlacement, promoteWaitlist, mentorLabId,
  notifyUser, notifyRole, settlePublications, publishEffectiveAt,
} from '../lib/flow.js';

const router = Router();
router.use(authenticate, blockUntilPasswordChanged);

// 统一异常出口：FlowError.status 直接映射 HTTP 码。
const h = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    res.json(out === undefined ? { ok: true } : out);
  } catch (err) {
    if (!(err instanceof FlowError)) console.error('[flow:error]', err);
    res.status(err.status || 500).json({ error: err.message || '操作失败', ...(err.extra || {}) });
  }
};

const MENTOR_SELECT = `
  SELECT m.id, m.code, m.name, m.title, m.intro, m.lab_id, l.name AS lab_name,
         COALESCE(q.quota,0) AS quota,
         (SELECT COUNT(*) FROM placements p WHERE p.mentor_id=m.id AND p.status='confirmed') AS confirmed
  FROM mentors m JOIN labs l ON l.id=m.lab_id
  LEFT JOIN mentor_quotas q ON q.mentor_id=m.id`;

const scoreOf = (studentId, mentorId) =>
  db.prepare('SELECT score FROM interview_scores WHERE student_id=? AND mentor_id=?').get(studentId, mentorId)?.score ?? null;

// ══════════════════════════════════════════════════════════════
// 公共上下文：各流程页共用（阶段窗口 + 我的身份）
// ══════════════════════════════════════════════════════════════
router.get('/context', h((req) => ({
  serverTime: new Date().toISOString(),
  stages: [3, 4, 5, 6, 7, 8].map(stageInfo),
  role: req.user.role,
})));

// ══════════════════════════════════════════════════════════════
// 第 3 步 · 意向填报 (§5.1) — ≤3 平行志愿 + 两个独立服从勾选，提交即定
// ══════════════════════════════════════════════════════════════
router.get('/applications', h((req) => {
  if (req.user.role !== 'student') {
    const rows = db.prepare(`
      SELECT a.id, a.round_id, a.status, a.submitted_at, a.accept_internal_transfer, a.accept_cross_lab_transfer,
             s.student_no, s.name AS student_name, s.class_name, s.status AS student_status,
             (SELECT GROUP_CONCAT(m.name, '、') FROM application_choices c JOIN mentors m ON m.id=c.mentor_id WHERE c.application_id=a.id) AS mentors
      FROM applications a JOIN students s ON s.id=a.student_id ORDER BY a.id DESC LIMIT 200`).all();
    return {
      stage: stageInfo(3),
      applications: rows,
      mentors: db.prepare(`${MENTOR_SELECT} ORDER BY m.lab_id, m.id`).all()
        .map((m) => ({ ...m, remaining: Math.max(0, m.quota - m.confirmed) })),
    };
  }
  const stu = studentOf(req.user);
  const round = currentRoundFor(stu.id);
  const app = db.prepare('SELECT * FROM applications WHERE student_id=? AND round_id=?').get(stu.id, round.id);
  const choices = app ? db.prepare('SELECT mentor_id FROM application_choices WHERE application_id=?').all(app.id).map((r) => r.mentor_id) : [];
  return {
    stage: stageInfo(round.round_no === 1 ? 3 : 6),
    round: { id: round.id, roundNo: round.round_no, type: round.type, name: round.name, status: round.status },
    student: { id: stu.id, name: stu.name, status: stu.status },
    application: app ? {
      id: app.id, status: app.status, submittedAt: app.submitted_at, choices,
      acceptInternalTransfer: !!app.accept_internal_transfer, acceptCrossLabTransfer: !!app.accept_cross_lab_transfer,
    } : null,
    mentors: db.prepare(`${MENTOR_SELECT} ORDER BY m.lab_id, m.id`).all().map((m) => ({ ...m, remaining: Math.max(0, m.quota - m.confirmed) })),
    attachments: db.prepare('SELECT id,filename,mime_type,size_bytes,created_at FROM application_attachments WHERE student_id=? AND round_id=? ORDER BY id')
      .all(stu.id, round.id).map(attachmentMeta),
  };
}));

router.post('/applications', requireRole('student'), h((req) => {
  const stu = studentOf(req.user);
  const roundNo = Number(req.body.round_no) || currentRoundFor(stu.id).round_no;
  const round = roundOf(roundNo);
  requireStageOpen(roundNo === 1 ? 3 : 6, req.user);

  if (confirmedPlacement(stu.id)) throw new FlowError(409, '你已确认入组，志愿不可再改');
  if (['formal', 'failed'].includes(stu.status)) throw new FlowError(409, `当前状态「${stu.status}」不再开放填报`);

  const ids = [...new Set((Array.isArray(req.body.mentor_ids) ? req.body.mentor_ids : []).map(Number).filter(Boolean))];
  if (ids.length === 0) throw new FlowError(400, '请至少选择 1 位导师志愿');
  if (ids.length > 3) throw new FlowError(400, '最多 3 个平行导师志愿（不分先后）');
  const known = db.prepare('SELECT id FROM mentors').all().map((r) => r.id);
  const bad = ids.filter((i) => !known.includes(i));
  if (bad.length) throw new FlowError(400, `导师不存在：${bad.join(',')}`);
  if (req.body.confirm !== true) throw new FlowError(400, '请先在预览页勾选二次确认（提交即定，不可修改）');

  const internal = req.body.accept_internal_transfer ? 1 : 0;
  const cross = req.body.accept_cross_lab_transfer ? 1 : 0;

  return tx(() => {
    const existing = db.prepare('SELECT * FROM applications WHERE student_id=? AND round_id=?').get(stu.id, round.id);
    if (existing && existing.status === 'submitted') throw new FlowError(409, '志愿已提交即定，如需修改请找教务退回解锁');

    let appId;
    if (existing) {
      db.prepare(`UPDATE applications SET status='submitted', submitted_at=?, accept_internal_transfer=?, accept_cross_lab_transfer=?, updated_at=? WHERE id=?`)
        .run(nowIso(), internal, cross, nowIso(), existing.id);
      db.prepare('DELETE FROM application_choices WHERE application_id=?').run(existing.id);
      appId = existing.id;
    } else {
      const r = db.prepare(`INSERT INTO applications(round_id,student_id,accept_internal_transfer,accept_cross_lab_transfer,status,submitted_at)
        VALUES(?,?,?,?,'submitted',?)`).run(round.id, stu.id, internal, cross, nowIso());
      appId = Number(r.lastInsertRowid);
    }
    const ins = db.prepare('INSERT INTO application_choices(application_id,mentor_id) VALUES(?,?)');
    ids.forEach((mid) => ins.run(appId, mid));
    // 提交前上传的附件随志愿一并锁定
    db.prepare('UPDATE application_attachments SET application_id=? WHERE student_id=? AND round_id=? AND application_id IS NULL').run(appId, stu.id, round.id);
    setStudentStatus(stu.id, 'filled');
    logAudit({ actorUserId: req.user.id, actorRole: 'student', action: 'submit_application', entityType: 'application', entityId: appId, studentId: stu.id, roundId: round.id, detail: { mentors: ids, internal, cross } });
    return { applicationId: appId, mentors: ids.length };
  });
}));

// ── 填报附件：证明材料随志愿上传；提交前可增删，提交后锁定仅可下载 ──
const ATTACH_MAX_BYTES = 5 * 1024 * 1024;
const ATTACH_MAX_COUNT = 5;
// 白名单扩展名 → 服务端推导 MIME（不信任客户端声明），下载一律 attachment 杜绝内联执行。
const ATTACH_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
};

const attachmentMeta = (r) => ({ id: r.id, filename: r.filename, mimeType: r.mime_type, sizeBytes: r.size_bytes, createdAt: r.created_at });

// 与提交志愿同一套前置校验：窗口开放、未确认入组、非终态、志愿未锁定。
function attachableContext(req) {
  const stu = studentOf(req.user);
  const round = currentRoundFor(stu.id);
  requireStageOpen(round.round_no === 1 ? 3 : 6, req.user);
  if (confirmedPlacement(stu.id)) throw new FlowError(409, '你已确认入组，附件不可再改');
  if (['formal', 'failed'].includes(stu.status)) throw new FlowError(409, `当前状态「${stu.status}」不再开放填报`);
  const app = db.prepare('SELECT status FROM applications WHERE student_id=? AND round_id=?').get(stu.id, round.id);
  if (app?.status === 'submitted') throw new FlowError(409, '志愿已提交即定，附件随志愿锁定；如需变更请找教务退回解锁');
  return { stu, round };
}

router.post('/attachments', requireRole('student'), h((req) => {
  const { stu, round } = attachableContext(req);
  const rawName = String(req.body.filename ?? '').split(/[\\/]/).pop()
    .split('').filter((ch) => ch.charCodeAt(0) >= 32).join('').trim();
  if (!rawName) throw new FlowError(400, '文件名无效');
  if (rawName.length > 120) throw new FlowError(400, '文件名过长（最多 120 字符）');
  const ext = rawName.includes('.') ? rawName.split('.').pop().toLowerCase() : '';
  const mime = ATTACH_TYPES[ext];
  if (!mime) throw new FlowError(400, `不支持的文件类型「.${ext || '无扩展名'}」，可上传文档 / 表格 / 演示 / 图片 / 压缩包 / 文本`);
  const b64 = String(req.body.content_base64 ?? '');
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new FlowError(400, '文件内容不是有效的 base64');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length === 0) throw new FlowError(400, '文件为空');
  if (buf.length > ATTACH_MAX_BYTES) throw new FlowError(413, '单个文件不能超过 5MB');
  const count = db.prepare('SELECT COUNT(*) c FROM application_attachments WHERE student_id=? AND round_id=?').get(stu.id, round.id).c;
  if (count >= ATTACH_MAX_COUNT) throw new FlowError(409, `最多上传 ${ATTACH_MAX_COUNT} 个附件，请先删除再添加`);

  return tx(() => {
    const r = db.prepare(`INSERT INTO application_attachments(student_id,round_id,filename,mime_type,size_bytes,content,uploaded_by)
      VALUES(?,?,?,?,?,?,?)`).run(stu.id, round.id, rawName, mime, buf.length, buf, req.user.id);
    const id = Number(r.lastInsertRowid);
    logAudit({ actorUserId: req.user.id, actorRole: 'student', action: 'upload_attachment', entityType: 'application_attachment', entityId: id, studentId: stu.id, roundId: round.id, detail: { filename: rawName, size: buf.length } });
    return { id, filename: rawName, sizeBytes: buf.length };
  });
}));

router.delete('/attachments/:id', requireRole('student'), h((req) => {
  const { stu, round } = attachableContext(req);
  const row = db.prepare('SELECT id, student_id, round_id, filename FROM application_attachments WHERE id=?').get(Number(req.params.id));
  if (!row || row.student_id !== stu.id) throw new FlowError(404, '附件不存在');
  if (row.round_id !== round.id) throw new FlowError(409, '该附件属于历史轮次，不可删除');
  return tx(() => {
    db.prepare('DELETE FROM application_attachments WHERE id=?').run(row.id);
    logAudit({ actorUserId: req.user.id, actorRole: 'student', action: 'delete_attachment', entityType: 'application_attachment', entityId: row.id, studentId: stu.id, roundId: round.id, detail: { filename: row.filename } });
    return { deleted: row.id };
  });
}));

// 下载不走 h()（h 会 res.json），直接输出二进制；仅本人可下载。
router.get('/attachments/:id/download', requireRole('student'), (req, res) => {
  try {
    const stu = studentOf(req.user);
    const row = db.prepare('SELECT * FROM application_attachments WHERE id=? AND student_id=?').get(Number(req.params.id), stu.id);
    if (!row) throw new FlowError(404, '附件不存在或无权下载');
    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="attachment-${row.id}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', row.size_bytes);
    res.end(Buffer.from(row.content));
  } catch (err) {
    if (!(err instanceof FlowError)) console.error('[flow:error]', err);
    res.status(err.status || 500).json({ error: err.message || '下载失败' });
  }
});

// ══════════════════════════════════════════════════════════════
// 第 4 步 · 导师初选与面试 (§4 步4) — 全员必面，打分
// ══════════════════════════════════════════════════════════════
function myApplicants(mentorId) {
  return db.prepare(`
    SELECT s.id AS student_id, s.student_no, s.name, s.class_name, s.status AS student_status,
           a.round_id, r.round_no,
           (SELECT score FROM interview_scores i WHERE i.student_id=s.id AND i.mentor_id=?) AS score,
           (SELECT category FROM candidate_lists c WHERE c.student_id=s.id AND c.mentor_id=? AND c.status IN ('active','promoted','confirmed')) AS category
    FROM application_choices c
    JOIN applications a ON a.id=c.application_id AND a.status='submitted'
    JOIN students s ON s.id=a.student_id
    JOIN rounds r ON r.id=a.round_id
    WHERE c.mentor_id=?
    ORDER BY r.round_no, s.student_no`).all(mentorId, mentorId, mentorId);
}

router.get('/interview', requireRole('mentor'), h((req) => {
  const me = mentorOf(req.user);
  const applicants = myApplicants(me.id);
  const scored = applicants.filter((a) => a.score !== null).length;
  return {
    stage: stageInfo(4),
    mentor: { id: me.id, name: me.name, quota: quotaOf(me.id), confirmed: confirmedCount(me.id), remaining: remainingOf(me.id) },
    unscored: applicants.length - scored,
    listSubmitted: !!db.prepare('SELECT 1 x FROM candidate_lists WHERE mentor_id=? AND submitted_at IS NOT NULL LIMIT 1').get(me.id),
    applicants,
  };
}));

router.post('/interview-scores', requireRole('mentor'), h((req) => {
  const me = mentorOf(req.user);
  requireStageOpen(4, req.user);
  const studentId = Number(req.body.student_id);
  const score = Number(req.body.score);
  if (!Number.isFinite(score) || score < 0) throw new FlowError(400, '面试分数需为非负数字');
  if (!myApplicants(me.id).some((a) => a.student_id === studentId)) throw new FlowError(403, '该学生不在你的志愿名单内，无权打分');

  return tx(() => {
    const existed = db.prepare('SELECT id FROM interview_scores WHERE student_id=? AND mentor_id=?').get(studentId, me.id);
    if (existed) db.prepare('UPDATE interview_scores SET score=?, note=?, scored_by=?, scored_at=? WHERE id=?')
      .run(score, req.body.note ?? null, req.user.id, nowIso(), existed.id);
    else db.prepare('INSERT INTO interview_scores(student_id,mentor_id,source_round_id,score,note,scored_by) VALUES(?,?,?,?,?,?)')
      .run(studentId, me.id, req.body.round_id ?? roundOf(1).id, score, req.body.note ?? null, req.user.id);

    // 全员必面：学生所填报的每位导师都给了分 → 进入已面试
    const apps = db.prepare(`
      SELECT a.id FROM applications a JOIN students s ON s.id=a.student_id
      WHERE a.student_id=? AND a.status='submitted'`).all(studentId);
    const pending = apps.reduce((acc, a) => acc + db.prepare(`
      SELECT COUNT(*) c FROM application_choices c JOIN interview_scores i ON i.student_id=? AND i.mentor_id=c.mentor_id
      WHERE c.application_id=? AND i.id IS NULL`).get(studentId, a.id).c, 0);
    if (pending === 0) setStudentStatus(studentId, 'interviewed');

    logAudit({ actorUserId: req.user.id, actorRole: 'mentor', action: 'score_interview', entityType: 'interview_score', entityId: studentId, studentId, detail: { mentor_id: me.id, score } });
    return { scored: score };
  });
}));

// ══════════════════════════════════════════════════════════════
// 第 4 步 · 候选名单 — 拟录取 / 递补(预排序) / 内部调剂；提交即锁定
// ══════════════════════════════════════════════════════════════
function myLists(mentorId) {
  const pick = (cat) => db.prepare(`
    SELECT c.*, s.student_no, s.name, s.class_name FROM candidate_lists c
    JOIN students s ON s.id=c.student_id
    WHERE c.mentor_id=? AND c.category=? ORDER BY c.waitlist_rank IS NULL, c.waitlist_rank, c.id`).all(mentorId, cat);
  return { admits: pick('admit'), waitlist: pick('waitlist'), internal: pick('internal_transfer') };
}

router.get('/candidate-lists', requireRole('mentor'), h((req) => {
  const me = mentorOf(req.user);
  const lists = myLists(me.id);
  const locked = !!db.prepare('SELECT 1 x FROM candidate_lists WHERE mentor_id=? AND submitted_at IS NOT NULL LIMIT 1').get(me.id);
  return {
    stage: stageInfo(4),
    mentor: { id: me.id, name: me.name, quota: quotaOf(me.id), confirmed: confirmedCount(me.id), remaining: remainingOf(me.id) },
    locked,
    applicants: myApplicants(me.id),
    ...lists,
  };
}));

router.post('/candidate-lists', requireRole('mentor'), h((req) => {
  const me = mentorOf(req.user);
  requireStageOpen(4, req.user);
  if (req.body.confirm !== true) throw new FlowError(400, '请先勾选二次确认：名单提交即锁定，不可修改');
  const locked = db.prepare('SELECT 1 x FROM candidate_lists WHERE mentor_id=? AND submitted_at IS NOT NULL LIMIT 1').get(me.id);
  if (locked) throw new FlowError(409, '名单已提交锁定，如需变更请找教务解锁');

  const admits = [...new Set((req.body.admits || []).map(Number).filter(Boolean))];
  const waitlist = [...new Set((req.body.waitlist || []).map(Number).filter(Boolean))];
  const internal = [...new Set((req.body.internal_transfer || []).map(Number).filter(Boolean))];
  const quota = quotaOf(me.id);
  // 铁律：导师定人、名额定量 — 拟录取数超硬名额一律硬拦
  if (admits.length > quota) throw new FlowError(400, `拟录取 ${admits.length} 人超出你的硬名额 ${quota}，系统不予提交`);

  const pool = new Set(myApplicants(me.id).map((a) => a.student_id));
  const unscored = admits.filter((sid) => scoreOf(sid, me.id) === null);
  if (unscored.length) throw new FlowError(400, `以下学生尚未面试打分，不能列为拟录取：${unscored.join(',')}`);
  const foreign = [...admits, ...waitlist, ...internal].filter((sid) => !pool.has(sid));
  if (foreign.length) throw new FlowError(400, `以下学生未填报你，无法列入名单：${foreign.join(',')}`);
  const decided = [...admits, ...waitlist, ...internal];
  const dup = decided.filter((sid, i) => decided.indexOf(sid) !== i);
  if (dup.length) throw new FlowError(400, '同一学生不能重复出现在多个名单类别');

  const round = roundOf(1);
  return tx(() => {
    const stamp = nowIso();
    const ins = db.prepare('INSERT INTO candidate_lists(round_id,mentor_id,student_id,category,waitlist_rank,decided_by,submitted_at) VALUES(?,?,?,?,?,?,?)');
    admits.forEach((sid) => ins.run(round.id, me.id, sid, 'admit', null, req.user.id, stamp));
    waitlist.forEach((sid, i) => ins.run(round.id, me.id, sid, 'waitlist', i + 1, req.user.id, stamp));
    internal.forEach((sid) => ins.run(round.id, me.id, sid, 'internal_transfer', null, req.user.id, stamp));

    const insP = db.prepare("INSERT INTO placements(student_id,round_id,mentor_id,lab_id,source,candidate_id,status) VALUES(?,?,?,?, 'admit_confirm',?,'pending')");
    for (const sid of admits) {
      const cl = db.prepare("SELECT id FROM candidate_lists WHERE round_id=? AND mentor_id=? AND student_id=? AND category='admit'").get(round.id, me.id, sid);
      // 只挡「已确认去向」；仍在他处待确认的人要再生成一条，才能行使「多录取选唯一」
      if (!confirmedPlacement(sid)) {
        insP.run(sid, round.id, me.id, me.lab_id, cl.id);
        setStudentStatus(sid, 'pending_confirm');
      } else {
        if (cl) db.prepare("UPDATE candidate_lists SET status='skipped' WHERE id=?").run(cl.id);
      }
    }
    notifyRole('student', '拟录取名单已发布', `导师 ${me.name} 已提交候选名单，请在确认窗口查看并确认去向。`, 'action');
    logAudit({ actorUserId: req.user.id, actorRole: 'mentor', action: 'submit_candidate_list', entityType: 'mentor', entityId: me.id, roundId: round.id, detail: { admits, waitlist, internal, quota } });
    return { admits: admits.length, waitlist: waitlist.length, internal: internal.length };
  });
}));

// ══════════════════════════════════════════════════════════════
// 第 5 步 · 拟录取确认 — 单个自动确认；多个选唯一；确认瞬间加锁校验名额
// ══════════════════════════════════════════════════════════════
const pendingOf = (studentId) => db.prepare(`
  SELECT p.id, p.mentor_id, p.lab_id, p.source, p.created_at, m.name AS mentor_name, m.code AS mentor_code, l.name AS lab_name
  FROM placements p JOIN mentors m ON m.id=p.mentor_id JOIN labs l ON l.id=p.lab_id
  WHERE p.student_id=? AND p.status='pending' ORDER BY p.id`).all(studentId);

// 仅 1 个拟录取 → 自动确认（§5.3）
function autoConfirmSingle(studentId) {
  const pend = pendingOf(studentId);
  if (pend.length !== 1) return false;
  if (remainingOf(pend[0].mentor_id) <= 0) return false;
  confirmPlacement(studentId, pend[0].id, 'system');
  return true;
}

function confirmPlacement(studentId, placementId, actorRole, actorUserId = null) {
  return tx(() => {
    const p = db.prepare("SELECT * FROM placements WHERE id=? AND student_id=? AND status='pending'").get(placementId, studentId);
    if (!p) throw new FlowError(404, '待确认记录不存在或已处理');
    // 确认瞬间串行取写锁 + 名额校验：先到先得，后到提示名额已满并自动顺延
    if (remainingOf(p.mentor_id) <= 0) {
      db.prepare("UPDATE placements SET status='expired', updated_at=? WHERE id=?").run(nowIso(), p.id);
      const promoted = promoteWaitlist(p.mentor_id);
      notifyUser(studentId, '名额已满，请改选其他去向', `导师 ${db.prepare('SELECT name FROM mentors WHERE id=?').get(p.mentor_id).name} 的名额已被占满，你的该条拟录取已失效。`, 'action');
      throw new FlowError(409, '该导师名额已满，系统已自动顺延递补，请选择其他去向', { promoted });
    }
    const stamp = nowIso();
    db.prepare("UPDATE placements SET status='confirmed', confirmed_at=?, updated_at=? WHERE id=?").run(stamp, stamp, p.id);
    if (p.candidate_id) db.prepare("UPDATE candidate_lists SET status='confirmed' WHERE id=?").run(p.candidate_id);
    // 多录取选唯一：其余 pending 释放 → 触发各导师递补
    for (const other of pendingOf(studentId)) {
      db.prepare("UPDATE placements SET status='removed', updated_at=? WHERE id=?").run(stamp, other.id);
      if (other.source === 'admit_confirm') {
        const cl = db.prepare("SELECT id FROM candidate_lists WHERE round_id=? AND mentor_id=? AND student_id=? AND category='admit'").get(p.round_id, other.mentor_id, studentId);
        if (cl) db.prepare("UPDATE candidate_lists SET status='skipped' WHERE id=?").run(cl.id);
      }
      promoteWaitlist(other.mentor_id);
    }
    setStudentStatus(studentId, 'confirmed');
    logAudit({ actorUserId, actorRole, action: 'confirm_placement', entityType: 'placement', entityId: p.id, studentId, roundId: p.round_id, detail: { mentor_id: p.mentor_id, source: p.source } });
    return db.prepare('SELECT * FROM placements WHERE id=?').get(p.id);
  });
}

router.get('/confirm', requireRole('student'), h((req) => {
  const stu = studentOf(req.user);
  autoConfirmSingle(stu.id);
  const confirmed = confirmedPlacement(stu.id);
  return {
    stage: stageInfo(5),
    student: { id: stu.id, name: stu.name, status: stu.status },
    pending: pendingOf(stu.id),
    confirmed: confirmed ? {
      ...confirmed,
      mentor_name: db.prepare('SELECT name FROM mentors WHERE id=?').get(confirmed.mentor_id)?.name ?? null,
      lab_name: db.prepare('SELECT name FROM labs WHERE id=?').get(confirmed.lab_id)?.name ?? null,
    } : null,
  };
}));

router.post('/confirm', requireRole('student'), h((req) => {
  const stu = studentOf(req.user);
  requireStageOpen(5, req.user);
  if (req.body.confirm !== true) throw new FlowError(400, '确认即锁定、不可反悔，请先勾选二次确认');
  return { placement: confirmPlacement(stu.id, Number(req.body.placement_id), 'student', req.user.id) };
}));

router.post('/decline', requireRole('student'), h((req) => {
  const stu = studentOf(req.user);
  requireStageOpen(5, req.user);
  const id = Number(req.body.placement_id);
  return tx(() => {
    const p = db.prepare("SELECT * FROM placements WHERE id=? AND student_id=? AND status='pending'").get(id, stu.id);
    if (!p) throw new FlowError(404, '待确认记录不存在或已处理');
    db.prepare("UPDATE placements SET status='declined', updated_at=? WHERE id=?").run(nowIso(), p.id);
    if (p.candidate_id) db.prepare("UPDATE candidate_lists SET status='rejected' WHERE id=?").run(p.candidate_id);
    // 还有其他待确认时保持「待确认」，只有全部放弃才算未录取
    setStudentStatus(stu.id, pendingOf(stu.id).length ? 'pending_confirm' : 'unadmitted');
    const promoted = promoteWaitlist(p.mentor_id);
    logAudit({ actorUserId: req.user.id, actorRole: 'student', action: 'decline_placement', entityType: 'placement', entityId: p.id, studentId: stu.id, detail: { mentor_id: p.mentor_id, promoted } });
    return { declined: true, promoted };
  });
}));

// ══════════════════════════════════════════════════════════════
// 第 6 步 · 分轮补录 — 不重面试，沿用第 4 步成绩；纯志愿 + 名额匹配
// ══════════════════════════════════════════════════════════════
const unplacedStudents = () => db.prepare(`
  SELECT s.id, s.student_no, s.name, s.class_name, s.status FROM students s
  WHERE NOT EXISTS (SELECT 1 FROM placements p WHERE p.student_id=s.id AND p.status='confirmed')
    AND s.status NOT IN ('formal','failed')
  ORDER BY s.student_no`).all();

router.get('/supplementary', h((req) => {
  const rounds = db.prepare('SELECT * FROM rounds ORDER BY round_no').all();
  if (req.user.role === 'student') {
    const stu = studentOf(req.user);
    const round = currentRoundFor(stu.id);
    const app = db.prepare('SELECT * FROM applications WHERE student_id=? AND round_id=?').get(stu.id, round.id);
    return {
      stage: stageInfo(6),
      eligible: !confirmedPlacement(stu.id) && !['formal', 'failed'].includes(stu.status),
      round, myApplication: app ? { id: app.id, status: app.status, submittedAt: app.submitted_at } : null,
      placement: confirmedPlacement(stu.id) || db.prepare("SELECT * FROM placements WHERE student_id=? AND status='pending'").get(stu.id) || null,
      mentors: db.prepare(`${MENTOR_SELECT} ORDER BY m.lab_id, m.id`).all().map((m) => ({ ...m, remaining: Math.max(0, m.quota - m.confirmed) })),
    };
  }
  return {
    stage: stageInfo(6), rounds,
    unplaced: unplacedStudents(),
    mentors: db.prepare(`${MENTOR_SELECT} ORDER BY m.lab_id, m.id`).all().map((m) => ({ ...m, remaining: Math.max(0, m.quota - m.confirmed) })),
  };
}));

router.post('/supplementary/round', requireRole('academic_affairs'), h((req) => {
  requireStageOpen(6, req.user);
  const roundNo = Number(req.body.round_no);
  const round = roundOf(roundNo);
  if (round.type !== 'supplementary') throw new FlowError(400, '只能开启补录轮次');
  db.prepare("UPDATE rounds SET status='open' WHERE id=?").run(round.id);
  db.prepare("UPDATE stages SET force_state='forced_open', updated_by=?, updated_at=? WHERE stage_no=6").run(req.user.id, nowIso());
  notifyRole('student', '补录志愿已开放', `${round.name} 现已开放填报，未入组学生请重新填报志愿（沿用第 4 步面试成绩）。`, 'action');
  logAudit({ actorUserId: req.user.id, actorRole: req.user.role, action: 'open_supplementary_round', entityType: 'round', entityId: round.id, detail: { round_no: roundNo } });
  return { round };
}));

router.post('/supplementary/close', requireRole('academic_affairs'), h((req) => {
  const roundNo = Number(req.body.round_no);
  const round = roundOf(roundNo);
  if (round.type !== 'supplementary') throw new FlowError(400, '只能关闭补录轮次');
  db.prepare("UPDATE rounds SET status='closed' WHERE id=?").run(round.id);
  db.prepare("UPDATE stages SET force_state='forced_closed', updated_by=?, updated_at=? WHERE stage_no=6").run(req.user.id, nowIso());
  notifyRole('student', '补录志愿已关闭', `${round.name} 已关闭填报，未入组学生请等待全院统筹或教务线下回填。`, 'warn');
  logAudit({ actorUserId: req.user.id, actorRole: req.user.role, action: 'close_supplementary_round', entityType: 'round', entityId: round.id, detail: { round_no: roundNo } });
  return { round: db.prepare('SELECT * FROM rounds WHERE id=?').get(round.id) };
}));

router.post('/supplementary/match', requireRole('academic_affairs'), h((req) => {
  const roundNo = Number(req.body.round_no);
  const round = roundOf(roundNo);
  const apps = db.prepare("SELECT * FROM applications WHERE round_id=? AND status='submitted' ORDER BY submitted_at").all(round.id);
  const ranked = apps
    .map((a) => {
      const mentors = db.prepare('SELECT mentor_id FROM application_choices WHERE application_id=?').all(a.id).map((r) => r.mentor_id);
      const best = Math.max(-1, ...mentors.map((mid) => scoreOf(a.student_id, mid) ?? -1));
      return { a, mentors, best };
    })
    .sort((x, y) => y.best - x.best || x.a.id - y.a.id);

  const placed = [];
  const skipped = [];
  return tx(() => {
    for (const { a, mentors } of ranked) {
      if (hasAnyPlacement(a.student_id)) { skipped.push({ student_id: a.student_id, why: '已有去向' }); continue; }
      const mentor = mentors.find((mid) => remainingOf(mid) > 0);
      if (!mentor) {
        setStudentStatus(a.student_id, 'unadmitted');
        skipped.push({ student_id: a.student_id, why: '志愿导师名额均已满' });
        continue;
      }
      const r = db.prepare("INSERT INTO placements(student_id,round_id,mentor_id,lab_id,source,status) VALUES(?,?,?,?,'supplementary','pending')")
        .run(a.student_id, round.id, mentor, mentorLabId(mentor));
      setStudentStatus(a.student_id, 'pending_confirm');
      notifyUser(a.student_id, '补录拟录取，请确认去向', '你在补录志愿匹配中获得拟录取，请在确认窗口内确认。', 'action');
      placed.push({ student_id: a.student_id, mentor_id: mentor, placement_id: Number(r.lastInsertRowid) });
    }
    logAudit({ actorUserId: req.user.id, actorRole: req.user.role, action: 'supplementary_match', entityType: 'round', entityId: round.id, roundId: round.id, detail: { placed: placed.length, skipped: skipped.length } });
    return { placed, skipped };
  });
}));

// ══════════════════════════════════════════════════════════════
// 第 7 步 · 全院统筹调剂 (§5.7) — 服从即强制安置；①同室换导师 ②跨室 ③服从者兜底
// ══════════════════════════════════════════════════════════════
function consentFlags(studentId, roundId) {
  const app = db.prepare('SELECT * FROM applications WHERE student_id=? ORDER BY round_id DESC LIMIT 1').get(studentId)
    || db.prepare('SELECT * FROM applications WHERE student_id=? AND round_id=?').get(studentId, roundId);
  return { internal: !!app?.accept_internal_transfer, cross: !!app?.accept_cross_lab_transfer, app };
}
function appliedLabIds(studentId) {
  return db.prepare(`
    SELECT DISTINCT m.lab_id FROM application_choices c
    JOIN applications a ON a.id=c.application_id
    JOIN mentors m ON m.id=c.mentor_id
    WHERE a.student_id=?`).all(studentId).map((r) => r.lab_id);
}

router.get('/coordination', requireRole('academic_affairs'), h((req) => {
  const slots = db.prepare(`${MENTOR_SELECT} ORDER BY m.lab_id, m.id`).all()
    .map((m) => ({ ...m, remaining: Math.max(0, m.quota - m.confirmed) })).filter((m) => m.remaining > 0);
  const candidates = unplacedStudents().map((s) => {
    const c = consentFlags(s.id, 1);
    return { ...s, acceptInternal: c.internal, acceptCrossLab: c.cross, appliedLabs: appliedLabIds(s.id), pendingOffer: pendingOf(s.id).length > 0 };
  });
  return { stage: stageInfo(7), slots, candidates, totalRemaining: slots.reduce((a, m) => a + m.remaining, 0) };
}));

// 统筹安置即时生效：先释放该生尚未确认的拟录取，空位按各导师递补顺序顺延
function releasePendingOffers(studentId) {
  for (const p of pendingOf(studentId)) {
    db.prepare("UPDATE placements SET status='removed', updated_at=? WHERE id=?").run(nowIso(), p.id);
    promoteWaitlist(p.mentor_id);
  }
}

function forceAssign({ studentId, mentorId, source, roundId, actorUserId, actorRole }) {
  releasePendingOffers(studentId);
  const r = db.prepare("INSERT INTO placements(student_id,round_id,mentor_id,lab_id,source,status,confirmed_at) VALUES(?,?,?,?,'coordination','confirmed',?)")
    .run(studentId, roundId, mentorId, mentorLabId(mentorId), nowIso());
  db.prepare("UPDATE placements SET source=? WHERE id=?").run(source, Number(r.lastInsertRowid));
  setStudentStatus(studentId, 'confirmed');
  notifyUser(studentId, '统筹调剂结果', `你已被调剂至导师「${db.prepare('SELECT name FROM mentors WHERE id=?').get(mentorId).name}」，服从调剂即强制安置，无需再确认。`, 'warn');
  logAudit({ actorUserId, actorRole, action: 'coordination_assign', entityType: 'placement', entityId: Number(r.lastInsertRowid), studentId, roundId, detail: { mentor_id: mentorId, source } });
  return Number(r.lastInsertRowid);
}

router.post('/coordination/run', requireRole('academic_affairs'), h((req) => {
  requireStageOpen(7, req.user);
  if (req.body.confirm !== true) throw new FlowError(400, '请先勾选二次确认：统筹调剂为强制安置');
  const round = roundOf(1);
  const result = { internal: [], cross: [], fallback: [], unadmitted: [] };
  return tx(() => {
    for (const s of unplacedStudents()) {
      const c = consentFlags(s.id, round.id);
      if (!c.internal && !c.cross) { setStudentStatus(s.id, 'unadmitted'); result.unadmitted.push(s.id); continue; }
      const labs = appliedLabIds(s.id);
      let chosen = null, source = null;
      if (c.internal) { // ① 同室换导师：只在本室找空位
        const sameLab = db.prepare(`${MENTOR_SELECT} ORDER BY m.id`).all()
          .map((m) => ({ ...m, remaining: Math.max(0, m.quota - m.confirmed) }))
          .find((m) => labs.includes(m.lab_id) && m.remaining > 0);
        if (sameLab) { chosen = sameLab; source = 'internal_transfer'; }
      }
      if (!chosen && c.cross) { // ② 跨实训室
        const any = db.prepare(`${MENTOR_SELECT} ORDER BY m.id`).all()
          .map((m) => ({ ...m, remaining: Math.max(0, m.quota - m.confirmed) }))
          .find((m) => !labs.includes(m.lab_id) && m.remaining > 0);
        if (any) { chosen = any; source = 'cross_lab_transfer'; }
      }
      if (!chosen && (c.internal || c.cross)) { // ③ 服从者最终兜底
        const any = db.prepare(`${MENTOR_SELECT} ORDER BY m.id`).all()
          .map((m) => ({ ...m, remaining: Math.max(0, m.quota - m.confirmed) }))
          .find((m) => m.remaining > 0);
        if (any) { chosen = any; source = 'coordination'; }
      }
      if (!chosen) { setStudentStatus(s.id, 'unadmitted'); result.unadmitted.push(s.id); continue; }
      forceAssign({ studentId: s.id, mentorId: chosen.id, source, roundId: round.id, actorUserId: req.user.id, actorRole: req.user.role });
      (source === 'internal_transfer' ? result.internal : source === 'cross_lab_transfer' ? result.cross : result.fallback).push({ student_id: s.id, mentor_id: chosen.id });
    }
    const dead = result.unadmitted.length > 0;
    if (dead) notifyRole('academic_affairs', '统筹后仍有未录取者', `${result.unadmitted.length} 名学生未勾选服从调剂或无空位，请导出名单线下回填去向。`, 'action');
    logAudit({ actorUserId: req.user.id, actorRole: req.user.role, action: 'run_coordination', entityType: 'round', entityId: round.id, detail: { counts: { internal: result.internal.length, cross: result.cross.length, fallback: result.fallback.length, unadmitted: result.unadmitted.length } } });
    return result;
  });
}));

router.post('/coordination/assign', requireRole('academic_affairs'), h((req) => {
  const studentId = Number(req.body.student_id);
  const mentorId = Number(req.body.mentor_id);
  if (remainingOf(mentorId) <= 0) throw new FlowError(409, '该导师名额已满');
  if (confirmedPlacement(studentId)) throw new FlowError(409, '该学生已确认去向，无需再统筹安置');
  return { placementId: forceAssign({ studentId, mentorId, source: 'coordination', roundId: roundOf(1).id, actorUserId: req.user.id, actorRole: req.user.role }) };
}));

// ══════════════════════════════════════════════════════════════
// 第 8 步 · 公示与申诉 (§5.8 §6) — 只晒姓名+实训室/导师；满 1 天无异议自动生效
// ══════════════════════════════════════════════════════════════
router.get('/publication', h((req) => {
  settlePublications();
  const rows = db.prepare(`
    SELECT p.id, p.status, p.published_at, p.effective_at, s.student_no, s.name AS student_name,
           m.name AS mentor_name, l.name AS lab_name, p.student_id
    FROM publications p JOIN students s ON s.id=p.student_id
    LEFT JOIN mentors m ON m.id=p.mentor_id LEFT JOIN labs l ON l.id=p.lab_id
    ORDER BY p.published_at DESC LIMIT 300`).all();
  const mine = req.user.role === 'student' ? rows.filter((r) => r.student_id === req.user.student_id) : null;
  const appeals = req.user.role === 'student'
    ? db.prepare('SELECT * FROM appeals WHERE student_id=? ORDER BY id DESC').all(req.user.student_id)
    : db.prepare("SELECT * FROM appeals WHERE status='pending' ORDER BY id DESC").all();
  return { stage: stageInfo(8), rows: req.user.role === 'student' ? mine : rows, my: mine?.[0] ?? null, appeals, canAppeal: req.user.role === 'student' };
}));

router.post('/publication/publish', requireRole('academic_affairs'), h((req) => {
  requireStageOpen(8, req.user);
  const targets = db.prepare(`
    SELECT p.* FROM placements p WHERE p.status='confirmed'
      AND NOT EXISTS (SELECT 1 FROM publications q WHERE q.placement_id=p.id)`).all();
  const ids = Array.isArray(req.body.student_ids) && req.body.student_ids.length
    ? targets.filter((p) => req.body.student_ids.map(Number).includes(p.student_id)) : targets;
  return tx(() => {
    const stamp = nowIso();
    const eff = publishEffectiveAt();
    const ins = db.prepare('INSERT INTO publications(student_id,placement_id,mentor_id,lab_id,effective_at) VALUES(?,?,?,?,?)');
    for (const p of ids) {
      ins.run(p.student_id, p.id, p.mentor_id, p.lab_id, eff);
      setStudentStatus(p.student_id, 'published');
    }
    if (ids.length) notifyRole('student', '录取公示已发布', `公示期至 ${eff}，满 1 天无异议自动生效入组；仅本人可申诉。`, 'warn');
    logAudit({ actorUserId: req.user.id, actorRole: req.user.role, action: 'publish_results', entityType: 'publication', entityId: null, detail: { count: ids.length, effective_at: eff } });
    return { published: ids.length, effectiveAt: eff };
  });
}));

router.post('/appeals', requireRole('student'), h((req) => {
  const stu = studentOf(req.user);
  requireStageOpen(8, req.user);
  const pubId = Number(req.body.publication_id);
  const pub = db.prepare('SELECT * FROM publications WHERE id=?').get(pubId);
  if (!pub) throw new FlowError(404, '公示记录不存在');
  if (pub.student_id !== stu.id) throw new FlowError(403, '仅学生本人可对本人的公示结果申诉');
  if (pub.status === 'removed') throw new FlowError(409, '该公示已被移除');
  const reason = String(req.body.reason || '').trim();
  if (reason.length < 5) throw new FlowError(400, '申诉理由过短（至少 5 字）');
  return tx(() => {
    const r = db.prepare('INSERT INTO appeals(publication_id,student_id,reason) VALUES(?,?,?)').run(pubId, stu.id, reason);
    db.prepare("UPDATE publications SET status='appealed' WHERE id=?").run(pubId);
    notifyRole('academic_affairs', '收到公示申诉', `学号 ${stu.student_no} 对公示记录 #${pubId} 提出申诉，请裁决。`, 'action');
    logAudit({ actorUserId: req.user.id, actorRole: 'student', action: 'file_appeal', entityType: 'appeal', entityId: Number(r.lastInsertRowid), studentId: stu.id, detail: { publication_id: pubId } });
    return { appealId: Number(r.lastInsertRowid) };
  });
}));

router.post('/appeals/:id/handle', requireRole('academic_affairs'), h((req) => {
  const id = Number(req.params.id);
  const appeal = db.prepare('SELECT * FROM appeals WHERE id=?').get(id);
  if (!appeal) throw new FlowError(404, '申诉不存在');
  if (appeal.status !== 'pending') throw new FlowError(409, '该申诉已处理');
  const decision = req.body.decision;
  if (!['upheld', 'rejected'].includes(decision)) throw new FlowError(400, 'decision 需为 upheld 或 rejected');
  const pub = db.prepare('SELECT * FROM publications WHERE id=?').get(appeal.publication_id);
  return tx(() => {
    db.prepare('UPDATE appeals SET status=?, handled_by=?, handled_at=?, resolution_note=? WHERE id=?')
      .run(decision, req.user.id, nowIso(), req.body.note ?? null, id);
    if (decision === 'upheld') {
      // 异议成立 → 移出 + 留空线下，不重跑；空位按预排递补
      db.prepare("UPDATE publications SET status='removed' WHERE id=?").run(pub.id);
      db.prepare("UPDATE placements SET status='removed', updated_at=? WHERE id=?").run(nowIso(), pub.placement_id);
      setStudentStatus(appeal.student_id, 'unadmitted');
      const promoted = pub.mentor_id ? promoteWaitlist(pub.mentor_id) : null;
      notifyUser(appeal.student_id, '申诉成立，公示已移除', '你的公示记录已被移除，去向转教务线下处理。', 'action');
      logAudit({ actorUserId: req.user.id, actorRole: req.user.role, action: 'appeal_upheld', entityType: 'appeal', entityId: id, studentId: appeal.student_id, detail: { publication_id: pub.id, promoted } });
      return { decision, promoted };
    }
    db.prepare("UPDATE publications SET status='published' WHERE id=?").run(pub.id);
    notifyUser(appeal.student_id, '申诉未成立', '教务已复核你的申诉，维持原公示结果。', 'info');
    logAudit({ actorUserId: req.user.id, actorRole: req.user.role, action: 'appeal_rejected', entityType: 'appeal', entityId: id, studentId: appeal.student_id, detail: { publication_id: pub.id } });
    return { decision };
  });
}));

// ══════════════════════════════════════════════════════════════
// 运行时内部调剂 (§1 §8) — 负责人仅同室换导师 + 异常兜底
// ══════════════════════════════════════════════════════════════
router.get('/internal-transfer', requireRole('lab_head', 'academic_affairs'), h((req) => {
  if (!req.user.lab_id) throw new FlowError(403, '该账号未绑定实训室');
  const rows = db.prepare(`${MENTOR_SELECT} WHERE m.lab_id=? ORDER BY m.id`).all(req.user.lab_id)
    .map((m) => ({ ...m, remaining: Math.max(0, m.quota - m.confirmed) }));
  const members = db.prepare(`
    SELECT p.id AS placement_id, p.status, s.id AS student_id, s.student_no, s.name, m.id AS mentor_id, m.name AS mentor_name
    FROM placements p JOIN students s ON s.id=p.student_id JOIN mentors m ON m.id=p.mentor_id
    WHERE m.lab_id=? AND p.status IN ('pending','confirmed') ORDER BY m.id, s.student_no`).all(req.user.lab_id);
  return { lab: db.prepare('SELECT * FROM labs WHERE id=?').get(req.user.lab_id), mentors: rows, members };
}));

router.post('/internal-transfer/move', requireRole('lab_head', 'academic_affairs'), h((req) => {
  const placementId = Number(req.body.placement_id);
  const toMentorId = Number(req.body.to_mentor_id);
  const p = db.prepare("SELECT * FROM placements WHERE id=? AND status IN ('pending','confirmed')").get(placementId);
  if (!p) throw new FlowError(404, '去向记录不存在或已结束');
  const to = db.prepare('SELECT * FROM mentors WHERE id=?').get(toMentorId);
  if (!to) throw new FlowError(400, '目标导师不存在');
  if (to.lab_id !== req.user.lab_id) throw new FlowError(403, '只能在本实训室内换导师（不跨室）');
  if (remainingOf(toMentorId) <= 0) throw new FlowError(409, '目标导师名额已满');
  const fromMentorId = p.mentor_id;
  if (fromMentorId === toMentorId) throw new FlowError(400, '目标导师与当前导师相同');
  return tx(() => {
    db.prepare('UPDATE placements SET mentor_id=?, lab_id=?, updated_at=? WHERE id=?').run(toMentorId, to.lab_id, nowIso(), p.id);
    // 公示榜记录的是去向快照，换导师后必须同步，否则榜单仍挂着旧导师
    db.prepare("UPDATE publications SET mentor_id=?, lab_id=? WHERE placement_id=? AND status<>'removed'").run(toMentorId, to.lab_id, p.id);
    const promoted = promoteWaitlist(fromMentorId);
    notifyUser(p.student_id, '内部调剂结果', `你已从导师「${db.prepare('SELECT name FROM mentors WHERE id=?').get(fromMentorId).name}」调整至「${to.name}」。`, 'warn');
    logAudit({ actorUserId: req.user.id, actorRole: req.user.role, action: 'internal_transfer_move', entityType: 'placement', entityId: p.id, studentId: p.student_id, detail: { from: fromMentorId, to: toMentorId, promoted } });
    return { moved: true, promoted };
  });
}));

// ══════════════════════════════════════════════════════════════
// 教务应急：强制推进 / 退回解锁 / 回填去向 / 审计
// ══════════════════════════════════════════════════════════════
router.post('/force-advance', requireRole('academic_affairs'), h((req) => {
  const mentorId = Number(req.body.mentor_id);
  const me = db.prepare('SELECT * FROM mentors WHERE id=?').get(mentorId);
  if (!me) throw new FlowError(400, '导师不存在');
  if (db.prepare('SELECT 1 x FROM candidate_lists WHERE mentor_id=? AND submitted_at IS NOT NULL LIMIT 1').get(mentorId)) {
    throw new FlowError(409, '该导师名单已提交，无需强制推进');
  }
  const quota = quotaOf(mentorId);
  const pool = myApplicants(mentorId).filter((a) => a.score !== null && !a.category);
  const ranked = pool.sort((x, y) => y.score - x.score);
  const admits = ranked.slice(0, quota).map((a) => a.student_id);
  const waitlist = ranked.slice(quota).map((a) => a.student_id);
  if (admits.length === 0) {
    notifyRole('academic_affairs', `导师 ${me.name} 无可推进名单`, '该导师名下没有已打分的志愿学生，请人工裁决。', 'action');
    return { admits: [], waitlist: [], note: '无可推进学生' };
  }
  return tx(() => {
    const round = roundOf(1);
    const stamp = nowIso();
    const ins = db.prepare('INSERT INTO candidate_lists(round_id,mentor_id,student_id,category,waitlist_rank,decided_by,submitted_at) VALUES(?,?,?,?,?,?,?)');
    admits.forEach((sid) => ins.run(round.id, mentorId, sid, 'admit', null, req.user.id, stamp));
    waitlist.forEach((sid, i) => ins.run(round.id, mentorId, sid, 'waitlist', i + 1, req.user.id, stamp));
    const insP = db.prepare("INSERT INTO placements(student_id,round_id,mentor_id,lab_id,source,candidate_id,status) VALUES(?,?,?,?, 'admit_confirm',?,'pending')");
    for (const sid of admits) {
      if (confirmedPlacement(sid)) continue;
      const cl = db.prepare("SELECT id FROM candidate_lists WHERE round_id=? AND mentor_id=? AND student_id=? AND category='admit'").get(round.id, mentorId, sid);
      insP.run(sid, round.id, mentorId, me.lab_id, cl.id);
      setStudentStatus(sid, 'pending_confirm');
    }
    logAudit({ actorUserId: req.user.id, actorRole: req.user.role, action: 'force_advance', entityType: 'mentor', entityId: mentorId, detail: { admits, waitlist, by_score: true } });
    return { admits, waitlist };
  });
}));

router.post('/unlock', requireRole('academic_affairs'), h((req) => {
  const kind = req.body.kind || 'application';
  const id = Number(req.body.id);
  return tx(() => {
    if (kind === 'application') {
      const a = db.prepare('SELECT * FROM applications WHERE id=?').get(id);
      if (!a) throw new FlowError(404, '志愿记录不存在');
      db.prepare("UPDATE applications SET status='returned', submitted_at=NULL, updated_at=? WHERE id=?").run(nowIso(), a.id);
      setStudentStatus(a.student_id, 'pending_fill');
      notifyUser(a.student_id, '志愿已退回，可重新填报', '教务已解锁你的志愿提交，请在填报窗口内重新填报。', 'action');
      logAudit({ actorUserId: req.user.id, actorRole: req.user.role, action: 'unlock_application', entityType: 'application', entityId: a.id, studentId: a.student_id });
      return { unlocked: 'application', id };
    }
    if (kind === 'candidate_list') {
      const rows = db.prepare('SELECT * FROM candidate_lists WHERE mentor_id=? AND submitted_at IS NOT NULL').all(id);
      if (!rows.length) throw new FlowError(404, '该导师无已提交名单');
      for (const r of rows) {
        if (r.status === 'confirmed') continue;
        db.prepare('DELETE FROM candidate_lists WHERE id=?').run(r.id);
        db.prepare("DELETE FROM placements WHERE student_id=? AND mentor_id=? AND status='pending'").run(r.student_id, r.mentor_id);
        // 其他导师仍有可能待确认 → 保持「待确认」，只有清空后才回退到已面试
        setStudentStatus(r.student_id, pendingOf(r.student_id).length ? 'pending_confirm' : 'interviewed');
      }
      logAudit({ actorUserId: req.user.id, actorRole: req.user.role, action: 'unlock_candidate_list', entityType: 'mentor', entityId: id, detail: { removed: rows.length } });
      return { unlocked: 'candidate_list', mentor_id: id };
    }
    throw new FlowError(400, 'kind 需为 application 或 candidate_list');
  });
}));

router.post('/backfill', requireRole('academic_affairs'), h((req) => {
  const studentId = Number(req.body.student_id);
  const outcome = req.body.outcome;
  if (!['formal', 'failed'].includes(outcome)) throw new FlowError(400, 'outcome 需为 formal 或 failed');
  const stu = db.prepare('SELECT * FROM students WHERE id=?').get(studentId);
  if (!stu) throw new FlowError(404, '学生不存在');
  return tx(() => {
    const placed = confirmedPlacement(studentId);
    if (placed) {
      const m = db.prepare('SELECT name FROM mentors WHERE id=?').get(placed.mentor_id);
      throw new FlowError(409, `该生已有确认去向（${m?.name ?? '导师'}），无需回填；如需改判请先释放其去向`);
    }
    if (outcome === 'formal') {
      const mentorId = Number(req.body.mentor_id);
      if (!mentorId) throw new FlowError(400, '回填为正式入组需指定导师');
      if (remainingOf(mentorId) <= 0) throw new FlowError(409, '该导师名额已满');
      const r = db.prepare("INSERT INTO placements(student_id,round_id,mentor_id,lab_id,source,status,confirmed_at) VALUES(?,?,?,?,'manual_backfill','confirmed',?)")
        .run(studentId, roundOf(1).id, mentorId, mentorLabId(mentorId), nowIso());
      db.prepare('INSERT INTO publications(student_id,placement_id,mentor_id,lab_id,effective_at,status) VALUES(?,?,?,?,?,?)')
        .run(studentId, Number(r.lastInsertRowid), mentorId, mentorLabId(mentorId), nowIso(), 'effective');
    }
    setStudentStatus(studentId, outcome);
    logAudit({ actorUserId: req.user.id, actorRole: req.user.role, action: 'backfill_outcome', entityType: 'student', entityId: studentId, studentId, detail: { outcome, mentor_id: req.body.mentor_id ?? null } });
    return { student: db.prepare('SELECT * FROM students WHERE id=?').get(studentId) };
  });
}));

router.get('/audit', requireRole('academic_affairs'), h((req) => {
  const logs = db.prepare(`
    SELECT a.*, s.student_no, s.name AS student_name, u.display_name AS actor_name
    FROM audit_logs a
    LEFT JOIN students s ON s.id=a.student_id
    LEFT JOIN users u ON u.id=a.actor_user_id
    ORDER BY a.id DESC LIMIT 200`).all();
  const outcomes = db.prepare(`
    SELECT s.id, s.student_no, s.name, s.class_name, s.status,
           m.name AS mentor_name, l.name AS lab_name, p.source, p.status AS placement_status,
           au.username AS account_username,
           (SELECT a.status FROM appeals a WHERE a.student_id=s.id ORDER BY a.id DESC LIMIT 1) AS appeal_status,
           (SELECT COUNT(*) FROM placements pp WHERE pp.student_id=s.id AND pp.status='pending') AS pending_offer
    FROM students s
    LEFT JOIN placements p ON p.student_id=s.id AND p.status='confirmed'
    LEFT JOIN mentors m ON m.id=p.mentor_id LEFT JOIN labs l ON l.id=p.lab_id
    LEFT JOIN users au ON au.role='student' AND au.student_id=s.id
    ORDER BY s.student_no`).all();
  const appeals = db.prepare(`
    SELECT a.id, a.status, a.reason, a.resolution_note, a.created_at, a.handled_at,
           s.student_no, s.name AS student_name, s.id AS student_id,
           p.id AS publication_id, p.status AS publication_status,
           m.name AS mentor_name, l.name AS lab_name
    FROM appeals a JOIN students s ON s.id=a.student_id
    JOIN publications p ON p.id=a.publication_id
    LEFT JOIN mentors m ON m.id=p.mentor_id LEFT JOIN labs l ON l.id=p.lab_id
    ORDER BY a.id DESC LIMIT 100`).all();
  const byStatus = outcomes.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  return { logs, outcomes, appeals, byStatus };
}));

export default router;
