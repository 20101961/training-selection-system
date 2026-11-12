import { db } from '../db/connection.js';
import { hashToken } from '../lib/security.js';

// 从 Authorization: Bearer <token> 解析会话。明文 token 不落库，只存 sha256。
export function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录' });

  const session = db
    .prepare('SELECT * FROM sessions WHERE token_hash = ?')
    .get(hashToken(token));
  if (!session) return res.status(401).json({ error: '会话无效' });
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
    return res.status(401).json({ error: '会话已过期' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  if (!user) return res.status(401).json({ error: '账号不存在' });

  req.user = user;
  req.session = session;
  next();
}

// 角色守卫 (§1 权限矩阵)。
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '无权限执行此操作' });
    }
    next();
  };
}

// 首次登录强制改密：未改密前只允许访问改密/登出/本人信息。
export function blockUntilPasswordChanged(req, res, next) {
  if (req.user?.must_change_password) {
    return res.status(428).json({ error: '首次登录须先修改密码', mustChangePassword: true });
  }
  next();
}

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.display_name,
    studentId: user.student_id,
    mentorId: user.mentor_id,
    labId: user.lab_id,
    mustChangePassword: !!user.must_change_password,
  };
}