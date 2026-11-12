import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { DonutChart, LineChart } from '../components/Charts';
import { Icon } from '../components/icons';
import type { DashboardData, TrendsData } from '../types';

const STAGE_LABEL: Record<string, string> = { pending: '未开始', open: '开放中', closed: '已关闭' };
const COUNT_CARDS: { key: string; label: string; icon: string }[] = [
  { key: 'labs', label: '实训室', icon: 'bank' },
  { key: 'mentors', label: '导师', icon: 'users' },
  { key: 'students', label: '学生', icon: 'cap' },
  { key: 'totalQuota', label: '总硬名额', icon: 'ticket' },
  { key: 'applicationsSubmitted', label: '已提交志愿', icon: 'fileText' },
  { key: 'pendingConfirm', label: '待确认', icon: 'hourglass' },
  { key: 'confirmed', label: '已确认入组', icon: 'checkCircle' },
  { key: 'formal', label: '正式入组', icon: 'flag' },
];

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [trends, setTrends] = useState<TrendsData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<DashboardData>('/dashboard').then(setData).catch((e) => setError(e.message));
    api<TrendsData>('/dashboard/trends').then(setTrends).catch(() => { /* 图表失败不阻塞页面 */ });
  }, []);

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <div className="page-loading">加载工作台…</div>;

  const cs = data.currentStage;
  return (
    <div className="page">
      <div className="page-head">
        <h2>工作台</h2>
        <div className="server-time">服务器时间：{new Date(data.serverTime).toLocaleString('zh-CN')}</div>
      </div>

      {cs && (
        <div className={`current-stage ${cs.effective}`}>
          当前阶段：<strong>第 {cs.stageNo} 步 · {cs.name}</strong>
          <span className={`pill ${cs.effective}`}>{STAGE_LABEL[cs.effective]}</span>
          <span className="window">{new Date(cs.opensAt).toLocaleString('zh-CN')} → {new Date(cs.closesAt).toLocaleString('zh-CN')}</span>
        </div>
      )}

      <div className="cards">
        {COUNT_CARDS.map((c) => (
          <div className="card lift" key={c.key}>
            <div className="card-top"><span className="card-icon"><Icon name={c.icon} size={19} /></span><span className="card-num">{data.counts[c.key] ?? 0}</span></div>
            <div className="card-label">{c.label}</div>
          </div>
        ))}
      </div>

      {trends && (
        <div className="charts-row">
          <section className="panel chart-panel lift">
            <h3><Icon name="chart" size={14} /> 近 7 日趋势</h3>
            <LineChart series={[
              { name: '志愿提交', color: '#2f6fed', points: trends.submitted },
              { name: '确认入组', color: '#1a9d5a', points: trends.confirmed },
            ]} />
          </section>
          <section className="panel chart-panel lift">
            <h3><Icon name="pie" size={14} /> 学生状态分布</h3>
            <DonutChart data={trends.statusPie} />
          </section>
        </div>
      )}

      <section className="panel">
        <h3>导师级硬名额（教务直分 · 导师定人、名额定量）</h3>
        <table className="grid">
          <thead><tr><th>导师</th><th>实训室</th><th>硬名额</th><th>已确认</th><th>剩余</th></tr></thead>
          <tbody>
            {data.mentors.map((m) => (
              <tr key={m.id}>
                <td>{m.name}（{m.code}）</td><td>{m.lab_name}</td>
                <td>{m.quota}</td><td>{m.confirmed}</td>
                <td className={m.remaining === 0 ? 'zero' : ''}>{m.remaining}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="two-col">
        <section className="panel lift">
          <h3>阶段时间窗（第 3–8 步）</h3>
          <ul className="stage-list">
            {data.stages.map((s) => (
              <li key={s.id}>
                <span className="stage-no">{s.stage_no}</span>
                <span className="stage-name">{s.name}</span>
                <span className={`pill ${s.effective}`}>{STAGE_LABEL[s.effective]}</span>
                {s.force_state && <span className="force-tag">教务强制</span>}
              </li>
            ))}
          </ul>
        </section>

        <section className="panel lift">
          <h3>最近审计</h3>
          {data.recentAudit.length === 0 ? <p className="empty">暂无审计记录</p> : (
            <ul className="audit-list">
              {data.recentAudit.map((a) => (
                <li key={a.id}><code>{a.action}</code> · {a.actor_role || '系统'} · {new Date(a.created_at).toLocaleTimeString('zh-CN')}</li>
              ))}
            </ul>
          )}
          <h3>站内提示</h3>
          {data.notices.length === 0 ? <p className="empty">暂无提示</p> : (
            <ul className="notice-list">
              {data.notices.map((n) => <li key={n.id} className={n.level}><strong>{n.title}</strong>{n.body && <span> — {n.body}</span>}</li>)}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}