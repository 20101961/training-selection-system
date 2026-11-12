import { useState } from 'react';
import { Icon } from '../../components/icons';
import type { MentorSlot } from './shared';
import { Line, Notice, QuotaBar, useFlowData, useSubmit } from './shared';

interface Member {
  placement_id: number;
  status: string;
  student_id: number;
  student_no: string;
  name: string;
  mentor_id: number;
  mentor_name: string;
}

interface TransferData {
  lab: { id: number; code: string; name: string; description: string | null };
  mentors: MentorSlot[];
  members: Member[];
}

export default function InternalTransfer() {
  const { data, error: loadErr, reload } = useFlowData<TransferData>('/flow/internal-transfer');
  const submit = useSubmit(reload);
  const [targets, setTargets] = useState<Record<number, number>>({});

  if (loadErr) return <div className="alert error">{loadErr}</div>;
  if (!data) return <div className="page-loading">加载本室成员…</div>;

  function move(placementId: number) {
    const to = targets[placementId];
    if (!to) { submit.setError('请先选择目标导师'); return; }
    void submit.run('/flow/internal-transfer/move', { placement_id: placementId, to_mentor_id: to });
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>内部调剂协调</h2>
        <span className="hint">运行时 · 仅同实训室内换导师，不跨室、不分配名额</span>
      </div>
      <Notice error={submit.error} flash={submit.flash} />

      <section className="panel lift">
        <h3><Icon name="bank" size={14} /> {data.lab.name}</h3>
        <div className="detail-grid">
          <Line k="实训室编号" v={data.lab.code} />
          <Line k="简介" v={data.lab.description || '—'} />
          <Line k="在室导师" v={data.mentors.length} />
          <Line k="在室成员" v={data.members.length} />
        </div>
        <div className="mentor-grid">
          {data.mentors.map((m) => (
            <div className="mentor-chip static lift" key={m.id}>
              <span className="chip-name">{m.name}<em>{m.title || '导师'}</em></span>
              <span className="chip-lab">硬名额 {m.quota} · 已确认 {m.confirmed}</span>
              <QuotaBar m={m} />
            </div>
          ))}
        </div>
        <p className="hint">换出导师腾出的名额会立刻按其递补预排序顺延一位（被顶上者仍需本人确认）。</p>
      </section>

      <section className="panel lift">
        <h3><Icon name="refresh" size={14} /> 成员与调剂操作</h3>
        {data.members.length === 0 ? <p className="empty">本室暂无 pending / confirmed 去向成员。</p> : (
          <table className="grid">
            <thead><tr><th>学号</th><th>姓名</th><th>当前导师</th><th>去向状态</th><th>调至（本室内有余位）</th><th>操作</th></tr></thead>
            <tbody>
              {data.members.map((r) => (
                <tr key={r.placement_id}>
                  <td>{r.student_no}</td>
                  <td>{r.name}</td>
                  <td>{r.mentor_name}</td>
                  <td><span className={`tag ${r.status}`}>{r.status === 'confirmed' ? '已确认' : '待确认'}</span></td>
                  <td>
                    <select
                      className="mini"
                      value={targets[r.placement_id] ?? ''}
                      onChange={(e) => setTargets((p) => ({ ...p, [r.placement_id]: Number(e.target.value) }))}
                    >
                      <option value="">选择目标导师</option>
                      {data.mentors
                        .filter((m) => m.id !== r.mentor_id && m.remaining > 0)
                        .map((m) => <option key={m.id} value={m.id}>{m.name}（余 {m.remaining}）</option>)}
                    </select>
                  </td>
                  <td className="actions">
                    <button
                      className="btn tiny"
                      disabled={submit.busy || !targets[r.placement_id]}
                      onClick={() => move(r.placement_id)}
                    >执行换导师</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint">跨室调整属教务统筹范围，负责人无权限；异常兜底请走「审计与回填」联系教务。</p>
      </section>
    </div>
  );
}
