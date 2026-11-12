import { Router } from 'express';
import { db } from '../db/connection.js';
import { hashPassword, verifyPassword, generateToken, hashToken } from '../lib/security.js';
import { logAudit } from '../lib/audit.js';
import { authenticate, publicUser, requireRole } from '../middleware/auth.js';

const router = Router();
const SESSION_TTL_MS = 12 * 3600 * 1000;

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '请输入账号和密码' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username));
  if (!user || !verifyPassword(String(password), user.password_hash)) {
    return res.status(401).json({ error: '账号或密码错误' });
  }

  const token = generateToken();
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES(?,?,?)').run(user.id, hashToken(token), expires);
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), user.id);
  logAudit({ actorUserId: user.id, actorRole: user.role, action: 'login' });

  res.json({ token, user: publicUser(user) });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post('/change-password', authenticate, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: '请输入原密码与新密码' });
  if (String(newPassword).length < 6) return res.status(400).json({ error: '新密码至少 6 位' });
  if (!verifyPassword(String(currentPassword), req.user.password_hash)) {
    return res.status(400).json({ error: '原密码错误' });
  }

  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(String(newPassword)), req.user.id);
  logAudit({ actorUserId: req.user.id, actorRole: req.user.role, action: 'change_password' });
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(updated) });
});

router.post('/logout', authenticate, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.session.id);
  logAudit({ actorUserId: req.user.id, actorRole: req.user.role, action: 'logout' });
  res.json({ ok: true });
});

// 教务应急：为已有学生重置登录密码；无账号者按学号创建。重置即吊销该生旧会话，须用新密码重登。
router.post('/admin/student-password', authenticate, requireRole('academic_affairs'), (req, res) => {
  const studentId = Number(req.body.student_id);
  const password = String(req.body.password || '');
  if (!studentId) return res.status(400).json({ error: '请指定学生' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  const stu = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!stu) return res.status(404).json({ error: '学生不存在' });

  const existing = db.prepare("SELECT * FROM users WHERE role = 'student' AND student_id = ?").get(studentId);
  const hash = hashPassword(password);
  let created = false;
  if (existing) {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, existing.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
  } else {
    db.prepare("INSERT INTO users(username, password_hash, role, display_name, student_id, must_change_password) VALUES(?, ?, 'student', ?, ?, 0)")
      .run(stu.student_no, hash, stu.name, studentId);
    created = true;
  }
  logAudit({ actorUserId: req.user.id, actorRole: req.user.role, action: 'admin_reset_password', entityType: 'student', entityId: studentId, studentId, detail: { created, username: stu.student_no } });
  res.json({ ok: true, username: stu.student_no, displayName: stu.name, created });
});

export default router;