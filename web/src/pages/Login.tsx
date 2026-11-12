import { useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/icons';

function FloatingBg() {
  const glyphs = ['flask', 'target', 'cap', 'chart', 'pie', 'compass', 'fileText', 'checkCircle'];
  return (
    <div className="auth-bg" aria-hidden="true">
      <span className="orb orb-1" />
      <span className="orb orb-2" />
      <span className="orb orb-3" />
      {glyphs.map((g, i) => (
        <span key={g} className={`bubble bubble-${i + 1}`}><Icon name={g} size={26 + (i % 3) * 8} /></span>
      ))}
    </div>
  );
}

function Field({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-icon"><Icon name={icon} size={17} /></span>
      <span className="field-body">
        <span className="field-label">{label}</span>
        {children}
      </span>
    </label>
  );
}

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user && !user.mustChangePassword) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const u = await login(username.trim(), password);
      navigate(u.mustChangePassword ? '/change-password' : '/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <FloatingBg />
      <form className={`auth-card ${error ? 'shake' : ''}`} onSubmit={onSubmit}>
        <div className="auth-logo"><Icon name="flask" size={38} /></div>
        <h1>实训室进组选拔填报系统</h1>
        <p className="sub">半自动选拔 · 前后台共用 SPA · 服务器时钟为准</p>
        <Field icon="user" label="账号（学号 / 工号）">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="如 admin / 2024001" autoFocus />
        </Field>
        <Field icon="key" label="密码">
          <span className="pwd-wrap">
            <input
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="初始密码 123456"
            />
            <button type="button" className="pwd-toggle" onClick={() => setShowPwd((v) => !v)} title={showPwd ? '隐藏密码' : '显示密码'}>
              <Icon name={showPwd ? 'eyeOff' : 'eye'} size={16} />
            </button>
          </span>
        </Field>
        {error && <div className="alert error">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : '登录'}</button>
        <div className="demo-hint">
          演示账号（初始密码均 <code>123456</code>，首次登录强制改密）：<br />
          教务 <code>admin</code> · 导师 <code>M001</code>/<code>M002</code>/<code>M003</code> · 负责人 <code>H001</code>/<code>H002</code><br />
          学生 <code>2024001</code>/<code>2024002</code>/<code>2024003</code>/<code>2024005</code>
        </div>
      </form>
    </div>
  );
}

export function ChangePassword() {
  const { user, loading, changePassword } = useAuth();
  const navigate = useNavigate();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // 刷新页面时 /auth/me 尚未返回，此时不能判定为未登录
  if (loading) return <div className="auth-page"><span className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustChangePassword) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (next !== confirm) { setError('两次输入的新密码不一致'); return; }
    setBusy(true);
    try {
      await changePassword(cur, next);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改失败');
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <FloatingBg />
      <form className={`auth-card ${error ? 'shake' : ''}`} onSubmit={onSubmit}>
        <div className="auth-logo"><Icon name="lock" size={38} /></div>
        <h1>首次登录 · 修改密码</h1>
        <p className="sub">为防止冒名，预置账号首次登录须修改密码（{user.displayName}）</p>
        <Field icon="key" label="原密码"><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoFocus /></Field>
        <Field icon="sparkle" label="新密码（至少 6 位）"><input type="password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <Field icon="checkCircle" label="确认新密码"><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        {error && <div className="alert error">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : '修改并进入系统'}</button>
      </form>
    </div>
  );
}
