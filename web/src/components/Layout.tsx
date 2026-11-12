import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Icon } from './icons';
import { ROLE_LABELS, type Role } from '../types';

interface NavItem { to: string; label: string; icon: string; roles?: Role[]; }

const NAV: NavItem[] = [
  { to: '/', label: '工作台', icon: 'grid' },
  { to: '/stages', label: '阶段时间窗', icon: 'clock' },
  { to: '/flow/fill', label: '意向填报', icon: 'pen', roles: ['student'] },
  { to: '/flow/confirm', label: '我的确认', icon: 'checkCircle', roles: ['student'] },
  { to: '/flow/interview', label: '初选与面试', icon: 'target', roles: ['mentor'] },
  { to: '/flow/candidate-lists', label: '候选名单', icon: 'list', roles: ['mentor'] },
  { to: '/flow/internal-transfer', label: '内部调剂协调', icon: 'refresh', roles: ['lab_head'] },
  { to: '/base', label: '底表与名额', icon: 'folder', roles: ['academic_affairs', 'lab_head', 'mentor'] },
  { to: '/flow/supplementary', label: '分轮补录', icon: 'plus', roles: ['academic_affairs', 'student'] },
  { to: '/flow/coordination', label: '全院统筹调剂', icon: 'compass', roles: ['academic_affairs'] },
  { to: '/flow/publication', label: '公示与申诉', icon: 'megaphone', roles: ['academic_affairs', 'student'] },
  { to: '/flow/audit', label: '审计与回填', icon: 'search', roles: ['academic_affairs'] },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const items = NAV.filter((n) => !n.roles || n.roles.includes(user.role));

  const onLogout = async () => { await logout(); navigate('/login', { replace: true }); };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-icon"><Icon name="flask" size={19} /></span><span className="brand-text">实训室进组选拔</span></div>
        <nav>
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <span className="nav-icon"><Icon name={n.icon} size={16} /></span>
              <span className="nav-label">{n.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="role-badge">{ROLE_LABELS[user.role]}</span>
          <span className="user-name">{user.displayName}</span>
          <span className="user-no">{user.username}</span>
          <button className="btn ghost" onClick={onLogout}>退出登录</button>
        </header>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  );
}