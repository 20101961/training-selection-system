import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { Icon } from '../../components/icons';
import type { StageWindow } from './shared';
import { Action, ConfirmCheck, Line, Notice, StageBanner, useFlowData, useSubmit } from './shared';

interface PubRow {
  id: number;
  status: string;
  published_at: string;
  effective_at: string;
  student_no: string;
  student_name: string;
  mentor_name: string | null;
  lab_name: string | null;
  student_id: number;
}

interface Appeal {
  id: number;
  publication_id: number;
  student_id: number;
  reason: string;
  status: string;
  handled_at: string | null;
  resolution_note: string | null;
  created_at: string;
}

interface PubData {
  stage: StageWindow;
  rows: PubRow[] | null;
  my: PubRow | null;
  appeals: Appeal[];
  canAppeal: boolean;
}

const PUB_STATUS: Record<string, string> = {
  published: '公示中',
  effective: '已生效入组',
  appealed: '申诉处理中',
  removed: '已移除',
};

export default function Publication() {
  const { user } = useAuth();
  const { data, error: loadErr, reload } = useFlowData<PubData>('/flow/publication');
  const submit = useSubmit(reload);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [notes, setNotes] = useState<Record<number, string>>({});

  if (loadErr) return <div className="alert error">{loadErr}</div>;
  if (!data) return <div className="page-loading">加载公示榜…</div>;

  const isStudent = user?.role === 'student';

  return (
    <div className="page">
      <div className="page-head">
        <h2>公示与申诉</h2>
        <span className="hint">第 8 步 · 只晒姓名 + 实训室 / 导师 · 满 1 天无异议自动生效</span>
      </div>
      <StageBanner stage={data.stage} />
      <Notice error={submit.error} flash={submit.flash} />

      {!isStudent && (
        <section className="panel lift">
          <h3><Icon name="megaphone" size={14} /> 发布公示</h3>
          <p className="hint">把所有「已确认入组」但尚未公示的去向一次性挂榜，生效时间 = 发布时间 + 1 天。</p>
          <ConfirmCheck on={confirm} setOn={setConfirm} text="我确认挂榜公示，公示期内接受本人申诉" />
          <Action
            busy={submit.busy}
            disabled={!confirm}
            icon="check"
            onClick={() => void submit.run('/flow/publication/publish', { confirm: true }).then((ok) => ok && setConfirm(false))}
          >
            发布录取公示
          </Action>
        </section>
      )}

      {isStudent && (
        <section className={`panel lift ${data.my ? 'done' : ''}`}>
          <h3><Icon name="user" size={14} /> 我的公示结果</h3>
          {!data.my ? <p className="empty">还没有属于你的公示记录（需先确认去向，再由教务挂榜）。</p> : (
            <>
              <div className="detail-grid">
                <Line k="姓名" v={data.my.student_name} />
                <Line k="录取实训室" v={data.my.lab_name || '—'} />
                <Line k="导师" v={data.my.mentor_name || '—'} />
                <Line k="公示状态" v={<span className={`tag ${data.my.status}`}>{PUB_STATUS[data.my.status] ?? data.my.status}</span>} />
                <Line k="公示时间" v={new Date(data.my.published_at).toLocaleString('zh-CN')} />
                <Line k="自动生效时间" v={new Date(data.my.effective_at).toLocaleString('zh-CN')} />
              </div>
              {data.my.status !== 'removed' && (
                <div className="appeal-box">
                  <h4><Icon name="flag" size={13} /> 仅本人可申诉</h4>
                  <textarea
                    className="wide"
                    rows={3}
                    placeholder="请写明异议内容（至少 5 字）：如成绩核算、名额占用、调剂意愿被忽视等"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <Action
                    busy={submit.busy}
                    disabled={reason.trim().length < 5}
                    icon="pen"
                    onClick={() => void submit.run('/flow/appeals', { publication_id: data.my!.id, reason: reason.trim() }).then((ok) => ok && setReason(''))}
                  >
                    提交申诉
                  </Action>
                  <p className="hint">申诉成立 → 该公示移除、名额按递补预排顺延；不成立 → 维持原公示，到期自动生效。</p>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {!isStudent && (
        <section className="panel lift">
          <h3><Icon name="list" size={14} /> 公示榜（{data.rows?.length ?? 0} 条）</h3>
          {(data.rows?.length ?? 0) === 0 ? <p className="empty">尚未发布公示。</p> : (
            <table className="grid">
              <thead><tr><th>学号</th><th>姓名</th><th>实训室</th><th>导师</th><th>状态</th><th>公示</th><th>生效</th></tr></thead>
              <tbody>
                {data.rows!.map((r) => (
                  <tr key={r.id}>
                    <td>{r.student_no}</td>
                    <td>{r.student_name}</td>
                    <td>{r.lab_name || '—'}</td>
                    <td>{r.mentor_name || '—'}</td>
                    <td><span className={`tag ${r.status}`}>{PUB_STATUS[r.status] ?? r.status}</span></td>
                    <td className="hint">{new Date(r.published_at).toLocaleString('zh-CN')}</td>
                    <td className="hint">{new Date(r.effective_at).toLocaleString('zh-CN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section className="panel lift">
        <h3><Icon name="shield" size={14} /> 申诉工单（{data.appeals.length}）</h3>
        {isStudent ? (
          data.appeals.length === 0 ? <p className="empty">我没有提交过申诉。</p> : (
            <ul className="notice-list">
              {data.appeals.map((a) => (
                <li key={a.id} className={a.status === 'pending' ? 'action' : ''}>
                  <strong>#{a.id} {a.status === 'pending' ? '待裁决' : a.status === 'upheld' ? '已成立' : '未成立'}</strong>
                  <span> — {a.reason}</span>
                  {a.resolution_note && <span className="hint"> · 处理意见：{a.resolution_note}</span>}
                </li>
              ))}
            </ul>
          )
        ) : data.appeals.length === 0 ? <p className="empty">当前没有待裁决申诉。</p> : (
          <table className="grid">
            <thead><tr><th>#</th><th>学号</th><th>公示</th><th>理由</th><th>处理意见</th><th>裁决</th></tr></thead>
            <tbody>
              {data.appeals.map((a) => (
                <tr key={a.id}>
                  <td>{a.id}</td>
                  <td>{data.rows?.find((r) => r.id === a.publication_id)?.student_no ?? a.student_id}</td>
                  <td>#{a.publication_id}</td>
                  <td className="reason-cell">{a.reason}</td>
                  <td>
                    <input
                      className="mini wide"
                      placeholder="复核结论说明（可选）"
                      value={notes[a.id] ?? ''}
                      onChange={(e) => setNotes((p) => ({ ...p, [a.id]: e.target.value }))}
                    />
                  </td>
                  <td className="actions">
                    <button
                      className="btn tiny"
                      disabled={submit.busy}
                      onClick={() => void submit.run(`/flow/appeals/${a.id}/handle`, { decision: 'upheld', note: notes[a.id] || null })}
                    >异议成立</button>
                    <button
                      className="btn tiny"
                      disabled={submit.busy}
                      onClick={() => void submit.run(`/flow/appeals/${a.id}/handle`, { decision: 'rejected', note: notes[a.id] || null })}
                    >维持原结果</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
