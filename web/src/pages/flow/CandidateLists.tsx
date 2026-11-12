import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/icons';
import type { StageWindow } from './shared';
import { Action, ConfirmCheck, Line, Notice, StageBanner, useFlowData, useSubmit } from './shared';

type Cat = '' | 'admit' | 'waitlist' | 'internal';

interface Applicant {
  student_id: number;
  student_no: string;
  name: string;
  class_name: string | null;
  score: number | null;
  category: string | null;
}

interface Row {
  id: number;
  student_id: number;
  student_no: string;
  name: string;
  waitlist_rank: number | null;
  status: string;
}

interface ListData {
  stage: StageWindow;
  mentor: { id: number; name: string; quota: number; confirmed: number; remaining: number };
  locked: boolean;
  applicants: Applicant[];
  admits: Row[];
  waitlist: Row[];
  internal: Row[];
}

const CAT_LABEL: Record<Exclude<Cat, ''>, string> = {
  admit: '拟录取',
  waitlist: '递补（预排序）',
  internal: '内部调剂',
};

export default function CandidateLists() {
  const { data, error: loadErr, reload } = useFlowData<ListData>('/flow/candidate-lists');
  const submit = useSubmit(reload);
  const [orderState, setOrderState] = useState<number[] | null>(null);
  const [assignedState, setAssignedState] = useState<Record<number, Cat> | null>(null);
  const [confirm, setConfirm] = useState(false);

  if (loadErr) return <div className="alert error">{loadErr}</div>;
  if (!data) return <div className="page-loading">加载候选名单…</div>;

  const applicants = data.applicants;
  const fallbackAssigned: Record<number, Cat> = {};
  for (const a of applicants) {
    fallbackAssigned[a.student_id] =
      a.category === 'admit' ? 'admit' : a.category === 'waitlist' ? 'waitlist' : a.category === 'internal_transfer' ? 'internal' : '';
  }
  const assigned = assignedState ?? fallbackAssigned;
  const order = orderState ?? applicants.map((a) => a.student_id);

  const byId = new Map(applicants.map((a) => [a.student_id, a]));
  const admits = order.filter((id) => assigned[id] === 'admit');
  const waitlist = order.filter((id) => assigned[id] === 'waitlist');
  const internal = order.filter((id) => assigned[id] === 'internal');
  const undecided = order.filter((id) => !assigned[id]);

  function setCat(id: number, cat: Cat) {
    // 函数式更新：同一批连续点击不会互相覆盖
    setAssignedState((prev) => ({ ...(prev ?? fallbackAssigned), [id]: cat }));
    setConfirm(false);
    if (cat && !orderState) setOrderState((prev) => (prev ?? order).filter((x) => x !== id).concat([id]));
  }

  function move(id: number, dir: -1 | 1) {
    const list = [...order];
    const i = list.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const cur = list[i];
    list[i] = list[j];
    list[j] = cur;
    setOrderState(list);
  }

  const overQuota = admits.length > data.mentor.quota;
  const unscoredAdmit = admits.filter((id) => byId.get(id)?.score === null);

  async function send() {
    const ok = await submit.run('/flow/candidate-lists', {
      admits,
      waitlist,
      internal_transfer: internal,
      confirm: true,
    });
    if (ok) setConfirm(false);
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>候选名单</h2>
        <span className="hint">第 4 步 · 导师定「人」、名额定「量」</span>
      </div>
      <StageBanner stage={data.stage} />
      <Notice error={submit.error} flash={submit.flash} />

      <section className="panel lift">
        <h3><Icon name="ticket" size={14} /> 名额闸门</h3>
        <div className="detail-grid">
          <Line k="我的硬名额" v={data.mentor.quota} />
          <Line k="本表拟录取数" v={<strong className={overQuota ? 'zero' : ''}>{admits.length}</strong>} />
          <Line k="已确认占用" v={data.mentor.confirmed} />
          <Line k="剩余可确认" v={data.mentor.remaining} />
        </div>
        {overQuota && <div className="alert error">拟录取 {admits.length} 人已超硬名额 {data.mentor.quota}，系统不会放行提交。</div>}
        {unscoredAdmit.length > 0 && (
          <div className="alert error">
            以下学生尚未面试打分，不能列为拟录取：{unscoredAdmit.map((id) => byId.get(id)?.name).join('、')}
          </div>
        )}
        {data.locked && <div className="alert ok">名单已提交锁定，提交即定；如需变更请教务解锁。</div>}
      </section>

      {!data.locked && (
        <section className="panel lift">
          <h3><Icon name="pen" size={14} /> 逐人裁决（{applicants.length} 名填报我的学生）</h3>
          {applicants.length === 0 ? (
            <p className="empty">还没有学生把我填入志愿。</p>
          ) : (
            <table className="grid">
              <thead><tr><th>学号</th><th>姓名</th><th>分数</th><th>裁决</th></tr></thead>
              <tbody>
                {applicants.map((a) => (
                  <tr key={a.student_id}>
                    <td>{a.student_no}</td>
                    <td>{a.name}<span className="hint"> {a.class_name || ''}</span></td>
                    <td className={a.score === null ? 'zero' : ''}>{a.score ?? '未打分'}</td>
                    <td>
                      <div className="cat-picker">
                        {(['admit', 'waitlist', 'internal', ''] as Cat[]).map((c) => (
                          <button
                            key={c || 'none'}
                            className={`seg ${assigned[a.student_id] === c ? 'on' : ''}`}
                            onClick={() => setCat(a.student_id, c)}
                          >
                            {c === '' ? '待定' : CAT_LABEL[c]}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {!data.locked && (
        <section className="panel lift">
          <h3><Icon name="list" size={14} /> 递补预排序（空位按此顺序自动顺延，可用 ↑↓ 调整）</h3>
          {waitlist.length === 0 ? <p className="empty">尚未把学生列为递补。</p> : (
            <ol className="rank-list">
              {waitlist.map((id) => (
                <li key={id}>
                  <span className="rank">#{waitlist.indexOf(id) + 1}</span>
                  <span className="who">{byId.get(id)?.name}（{byId.get(id)?.student_no}）</span>
                  <span className="score">面试 {byId.get(id)?.score ?? '—'}</span>
                  <span className="rank-ops">
                    <button className="btn tiny" onClick={() => move(id, -1)}>↑</button>
                    <button className="btn tiny" onClick={() => move(id, 1)}>↓</button>
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="hint">递补者不占拟录取名额；有人放弃、被顶掉或公示被移出时才被激活，且仍须本人确认去向。</p>
        </section>
      )}

      {data.locked && (
        <section className="panel lift">
          <h3><Icon name="folder" size={14} /> 已提交名单</h3>
          <div className="locked-cols">
            <div><h4>拟录取</h4>{data.admits.map((r) => <div key={r.id} className="locked-row">{r.name}（{r.student_no}）· {STATUS[r.status] ?? r.status}</div>)}</div>
            <div><h4>递补</h4>{data.waitlist.map((r) => <div key={r.id} className="locked-row">#{r.waitlist_rank} {r.name}（{r.student_no}）· {STATUS[r.status] ?? r.status}</div>)}</div>
            <div><h4>内部调剂</h4>{data.internal.map((r) => <div key={r.id} className="locked-row">{r.name}（{r.student_no}）</div>)}</div>
          </div>
        </section>
      )}

      {!data.locked && (
        <section className="panel lift">
          <h3><Icon name="checkCircle" size={14} /> 提交预览与二次确认</h3>
          <Line k="拟录取" v={admits.map((id) => byId.get(id)?.name).join('、') || '—'} />
          <Line k="递补顺序" v={waitlist.map((id, i) => `#${i + 1} ${byId.get(id)?.name}`).join(' → ') || '—'} />
          <Line k="内部调剂" v={internal.map((id) => byId.get(id)?.name).join('、') || '—'} />
          <Line k="待定（不列入）" v={undecided.map((id) => byId.get(id)?.name).join('、') || '—'} />
          <ConfirmCheck on={confirm} setOn={setConfirm} text="我确认以上名单，提交即锁定不可修改，且已知拟录取数不得超过硬名额" />
          <Action
            busy={submit.busy}
            disabled={data.locked || admits.length === 0 || overQuota || unscoredAdmit.length > 0 || !confirm}
            icon="check"
            onClick={() => void send()}
          >
            提交候选名单
          </Action>
          <p className="hint">提交后系统立即为每名拟录取学生生成「待确认去向」，并站内提示学生进入第 5 步确认。</p>
          <div className="flow-actions">
            <Link className="btn ghost" to="/flow/interview"><Icon name="target" size={14} /> 回面试打分</Link>
          </div>
        </section>
      )}
    </div>
  );
}

const STATUS: Record<string, string> = {
  active: '在名单',
  promoted: '已递补',
  confirmed: '已确认',
  skipped: '已跳过（他处入组）',
  rejected: '已拒绝',
};
