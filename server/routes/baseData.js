import { Router } from 'express';
import { db, nowIso, tx } from '../db/connection.js';
import { authenticate, blockUntilPasswordChanged, requireRole } from '../middleware/auth.js';
import { hashPassword } from '../lib/security.js';
import { logAudit } from '../lib/audit.js';

const router = Router();
router.use(authenticate, blockUntilPasswordChanged);

router.get('/labs', (_req, res) => {
  const rows = db.prepare(
    `SELECT l.*, COUNT(m.id) AS mentor_count, COALESCE(SUM(q.quota),0) AS total_quota
     FROM labs l LEFT JOIN mentors m ON m.lab_id=l.id
     LEFT JOIN mentor_quotas q ON q.mentor_id=m.id
     GROUP BY l.id ORDER BY l.id`
  ).all();
  res.json({ labs: rows });
});

router.get('/mentors', (_req, res) => {
  const rows = db.prepare(
    `SELECT m.*, l.name AS lab_name, COALESCE(q.quota,0) AS quota
     FROM mentors m JOIN labs l ON l.id=m.lab_id
     LEFT JOIN mentor_quotas q ON q.mentor_id=m.id ORDER BY m.lab_id, m.id`
  ).all();
  res.json({ mentors: rows });
});

router.get('/students', (req, res) => {
  // 学生仅见本人；职工端骨架阶段可见全量 (后续按管辖范围细化)。
  if (req.user.role === 'student') {
    const row = db.prepare('SELECT * FROM students WHERE id = ?').get(req.user.student_id);
    return res.json({ students: row ? [row] : [] });
  }
  res.json({ students: db.prepare('SELECT * FROM students ORDER BY id').all() });
});

// 教务名册导入：CSV 行 → upsert 学生（学号唯一），可选按学号批量建号（首次登录强制改密）。
// 前端解析文件后以 JSON 行提交；import_batches 留痕，整批事务，任一行致命错误即回滚。
router.post('/students/import', requireRole('academic_affairs'), (req, res) => {
  const raw = Array.isArray(req.body.rows) ? req.body.rows : [];
  const filename = String(req.body.filename || 'roster.csv').slice(0, 200);
  const createAccounts = !!req.body.create_accounts;
  const defaultPassword = String(req.body.default_password || '');
  if (!raw.length) return res.status(400).json({ error: '没有可导入的数据行' });
  if (raw.length > 2000) return res.status(400).json({ error: '单次最多导入 2000 行，请拆分文件' });
  if (createAccounts && defaultPassword.length < 6) return res.status(400).json({ error: '批量建号需设置至少 6 位的默认密码' });

  const errors = [];
  const seen = new Set();
  const cleaned = [];
  raw.forEach((r, i) => {
    const line = i + 1;
    const student_no = String(r?.student_no ?? '').trim();
    const name = String(r?.name ?? '').trim();
    const class_name = String(r?.class_name ?? '').trim() || null;
    const contact = String(r?.contact ?? '').trim() || null;
    if (!student_no || !name) { errors.push(`第 ${line} 行：学号与姓名必填，已跳过`); return; }
    if (seen.has(student_no)) { errors.push(`第 ${line} 行：学号 ${student_no} 在文件内重复，已跳过`); return; }
    seen.add(student_no);
    cleaned.push({ student_no, name, class_name, contact });
  });
  if (!cleaned.length) return res.status(400).json({ error: '没有有效数据行（需含学号与姓名）', errors });

  try {
    const result = tx(() => {
      const batch = db.prepare("INSERT INTO import_batches(kind,filename,row_count,status,imported_by) VALUES('students',?,?,'pending',?)")
        .run(filename, cleaned.length, req.user.id);
      const batchId = Number(batch.lastInsertRowid);
      const findStu = db.prepare('SELECT id FROM students WHERE student_no=?');
      const insStu = db.prepare("INSERT INTO students(student_no,name,class_name,contact,status) VALUES(?,?,?,?,'pending_fill')");
      const updStu = db.prepare('UPDATE students SET name=?, class_name=?, contact=?, updated_at=? WHERE id=?');
      const findUser = db.prepare("SELECT id FROM users WHERE role='student' AND student_id=?");
      const byUsername = db.prepare('SELECT id, student_id FROM users WHERE username=?');
      const insUser = db.prepare("INSERT INTO users(username,password_hash,role,display_name,student_id,must_change_password) VALUES(?,?,'student',?,?,1)");
      const hash = createAccounts ? hashPassword(defaultPassword) : null;
      let createdStudents = 0, updatedStudents = 0, createdAccounts = 0, existingAccounts = 0;
      for (const c of cleaned) {
        let stu = findStu.get(c.student_no);
        if (!stu) {
          const r = insStu.run(c.student_no, c.name, c.class_name, c.contact);
          stu = { id: Number(r.lastInsertRowid) };
          createdStudents++;
        } else {
          updStu.run(c.name, c.class_name, c.contact, nowIso(), stu.id);
          updatedStudents++;
        }
        if (createAccounts) {
          if (findUser.get(stu.id)) { existingAccounts++; continue; }
          const clash = byUsername.get(c.student_no);
          if (clash && clash.student_id !== stu.id) { errors.push(`学号 ${c.student_no}：账号名已被其他账号占用，跳过建号`); continue; }
          insUser.run(c.student_no, hash, c.name, stu.id);
          createdAccounts++;
        }
      }
      db.prepare("UPDATE import_batches SET status='done' WHERE id=?").run(batchId);
      logAudit({ actorUserId: req.user.id, actorRole: req.user.role, action: 'import_students', entityType: 'import_batch', entityId: batchId, detail: { filename, rows: cleaned.length, createdStudents, updatedStudents, createdAccounts, existingAccounts, skipped: errors.length } });
      return { batchId, createdStudents, updatedStudents, createdAccounts, existingAccounts };
    });
    res.json({ ok: true, ...result, errors });
  } catch (err) {
    res.status(400).json({ error: err?.message || '导入失败', errors });
  }
});

export default router;