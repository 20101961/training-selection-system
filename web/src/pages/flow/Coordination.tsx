import { useState } from 'react';
import { Icon } from '../../components/icons';
import type { MentorSlot, StageWindow } from './shared';
import { Action, ConfirmCheck, Line, Notice, QuotaBar, StageBanner, useFlowData, useSubmit } from './shared';

interface Candidate {
  id: number;
  student_no: string;
  name: string;
  class_name: string | null;
  status: string;
  acceptInternal: boolean;
  acceptCrossLab: boolean;
  appliedLabs: number[];
  pendingOffer: boolean;
}

interface CoordData {
  stage: StageWindow;
  slots: MentorSlot[];
  candidates: Candidate[];
  totalRemaining: number;
}

interface RunResult {
  internal: { student_id: number; mentor_id: number }[];
  cross: { student_id: number; mentor_id: number }[];
  fallback: { student_id: number; mentor_id: number }[];
  unadmitted: number[];
}

export default function Coordination() {
  const { data, error: loadErr, reload } = useFlowData<CoordData>('/flow/coordination');
  const submit = useSubmit(reload);
  const [confirm, setConfirm] = useState(false);
  const [picks, setPicks] = useState<Record<number, number>>({});
  const [result, setResult] = useState<RunResult | null>(null);

  if (loadErr) return <div className="alert error">{loadErr}</div>;
  if (!data) return <div className="page-loading">加载统筹池…</div>;

  async function runAll() {
    await submit.run<RunResult>('/flow/coordination/run', { confirm: true }, (out) => setResult(out));
    setConfirm(false);
  }

  async function assign(studentId: number) {
    const mentorId = picks[studentId];
    if (!mentorId) { submit.setError('请先为该学生选择目标导师'); return; }
    await submit.run('/flow/coordination/assign', { student_id: studentId, mentor_id: mentorId });
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>全院统筹调剂</h2>
        <span className="hint">第 7 步 · 服从即强制安置，不再逐个问学生</span>
      </div>
      <StageBanner stage={data.stage} />
      <Notice error={submit.error} flash={submit.flash} />

      <section className="panel lift">
        <h3><Icon name="compass" size={14} /> 统筹池总览</h3>
        <div className="detail-grid">
          <Line k="待统筹学生" v={<strong className={data.candidates.length ? 'warn' : ''}>{data.candidates.length}</strong>} />
          <Line k="全院剩余名额" v={data.totalRemaining} />
          <Line k="勾选内部调剂" v={data.candidates.filter((c) => c.acceptInternal).length} />
          <Line k="两项都不服从" v={<strong className="zero">{data.candidates.filter((c) => !c.acceptInternal && !c.acceptCrossLab).length}</strong>} />
        </div>
        <p className="hint">优先级：① 同实训室换导师 → ② 跨实训室 → ③ 服从者全院兜底；都不满足或从不服从 → 判未录取，转教务线下回填。安置即时生效，学生尚未确认的拟录取将被释放并触发该导师递补。</p>
      </section>

      <section className="panel lift">
        <h3><Icon name="refresh" size={14} /> 一键统筹</h3>
        <ConfirmCheck on={confirm} setOn={setConfirm} text="我确认执行全院统筹：结果直接生效为已确认去向，学生不再二次确认" />
        <Action busy={submit.busy} disabled={!confirm} icon="shield" onClick={() => void runAll()}>执行统筹调剂</Action>
        {result && (
          <div className="result-lines">
            <Line k="同室换导师" v={`${result.internal.length} 人`} />
            <Line k="跨实训室" v={`${result.cross.length} 人`} />
            <Line k="全院兜底" v={`${result.fallback.length} 人`} />
            <Line k="判为未录取" v={`${result.unadmitted.length} 人 · 请到「审计与回填」导出后线下回填`} />
          </div>
        )}
      </section>

      <section className="panel lift">
        <h3><Icon name="users" size={14} /> 剩余名额导师（只列有余位）</h3>
        {data.slots.length === 0 ? <p className="empty">全院名额已占满，无空位可调剂。</p> : (
          <div className="mentor-grid">
            {data.slots.map((m) => (
              <div className="mentor-chip static lift" key={m.id}>
                <span className="chip-name">{m.name}<em>{m.title || '导师'}</em></span>
                <span className="chip-lab">{m.lab_name}</span>
                <QuotaBar m={m} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel lift">
        <h3><Icon name="list" size={14} /> 逐人手工统筹（应急纠偏）</h3>
        {data.candidates.length === 0 ? <p className="empty">统筹池已清空。</p> : (
          <table className="grid">
            <thead><tr><th>学号</th><th>姓名</th><th>状态</th><th>服从内部</th><th>服从跨室</th><th>目标导师</th><th>操作</th></tr></thead>
            <tbody>
              {data.candidates.map((c) => (
                <tr key={c.id}>
                  <td>{c.student_no}</td>
                  <td>{c.name}</td>
                  <td>
                    <span className="tag">{c.status}</span>
                    {c.pendingOffer && <span className="tag pending_confirm" title="安置时自动释放该拟录取，空位按递补顺延">尚有待确认 offer</span>}
                  </td>
                  <td>{c.acceptInternal ? '是' : '否'}</td>
                  <td>{c.acceptCrossLab ? '是' : '否'}</td>
                  <td>
                    <select
                      className="mini"
                      value={picks[c.id] ?? ''}
                      onChange={(e) => setPicks((p) => ({ ...p, [c.id]: Number(e.target.value) }))}
                    >
                      <option value="">选择导师</option>
                      {data.slots.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}（{m.lab_name} · 余 {m.remaining}）</option>
                      ))}
                    </select>
                  </td>
                  <td className="actions">
                    <button className="btn tiny" disabled={submit.busy || !picks[c.id]} onClick={() => void assign(c.id)}>强制安置</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint">手工安置同样立即生效并留审计；不受时间窗限制的应急操作只对教务开放。</p>
      </section>
    </div>
  );
}
