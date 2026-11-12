import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { Stage } from '../types';

const LABEL: Record<string, string> = { pending: '未开始', open: '开放中', closed: '已关闭' };

export default function Stages() {
  const { user } = useAuth();
  const [stages, setStages] = useState<Stage[]>([]);
  const [serverTime, setServerTime] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const isAA = user?.role === 'academic_affairs';

  const load = useCallback(() => {
    api<{ stages: Stage[]; serverTime: string }>('/stages')
      .then((d) => { setStages(d.stages); setServerTime(d.serverTime); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  const force = async (id: number, state: string | null) => {
    setBusy(id); setError('');
    try {
      await api(`/stages/${id}/force`, { method: 'POST', body: { state } });
      load();
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); }
    finally { setBusy(null); }
  };

  return (
    <div className="page">
      <div className="page-head"><h2>阶段时间窗</h2><span className="hint">服务器时间为准 · 定时自动开合{isAA ? ' · 教务可应急强制开合' : ''}</span></div>
      {error && <div className="alert error">{error}</div>}
      <div className="server-time">服务器时间：{serverTime && new Date(serverTime).toLocaleString('zh-CN')}</div>
      <section className="panel">
        <table className="grid">
          <thead><tr><th>步</th><th>阶段</th><th>开放</th><th>关闭</th><th>状态</th>{isAA && <th>教务应急</th>}</tr></thead>
          <tbody>
            {stages.map((s) => (
              <tr key={s.id}>
                <td>{s.stage_no}</td><td>{s.name}</td>
                <td>{new Date(s.opens_at).toLocaleString('zh-CN')}</td>
                <td>{new Date(s.closes_at).toLocaleString('zh-CN')}</td>
                <td><span className={`pill ${s.effective}`}>{LABEL[s.effective]}</span>{s.force_state && <span className="force-tag">强制</span>}</td>
                {isAA && (
                  <td className="actions">
                    <button className="btn tiny" disabled={busy === s.id} onClick={() => force(s.id, 'forced_open')}>强制开</button>
                    <button className="btn tiny" disabled={busy === s.id} onClick={() => force(s.id, 'forced_closed')}>强制关</button>
                    <button className="btn tiny ghost" disabled={busy === s.id} onClick={() => force(s.id, null)}>恢复自动</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}