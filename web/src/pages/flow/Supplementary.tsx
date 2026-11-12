import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { Icon } from '../../components/icons';
import type { MentorSlot, StageWindow } from './shared';
import { Action, ConfirmCheck, Line, Notice, QuotaBar, StageBanner, useFlowData, useSubmit } from './shared';

interface SupData {
  stage: StageWindow;
  // 学生视角
  eligible?: boolean;
  round?: { id: number; round_no: number; type: string; name: string; status: string };
  myApplication?: { id: number; status: string; submittedAt: string } | null;
  placement?: { id: number; mentor_id: number; status: string } | null;
  mentors?: MentorSlot[];
  // 教务视角
  rounds?: { id: number; round_no: number; type: string; name: string; status: string }[];
  unplaced?: { id: number; student_no: string; name: string; class_name: string | null; status: string }[];
}

export default function Supplementary() {
  const { user } = useAuth();
  const isStudent = user?.role === 'student';
  const { data, error: loadErr, reload } = useFlowData<SupData>('/flow/supplementary');
  const submit = useSubmit(reload);

  if (loadErr) return <div className="alert error">{loadErr}</div>;
  if (!data) return <div className="page-loading">加载补录通道…</div>;

  return (
    <div className="page">
      <div className="page-head">
        <h2>分轮补录</h2>
        <span className="hint">第 6 步 · 不重面试，沿用第 4 步成绩 · 只对未入组者开放</span>
      </div>
      <StageBanner stage={data.stage} />
      <Notice error={submit.error} flash={submit.flash} />
      {isStudent ? <StudentView data={data} submit={submit} /> : <StaffView data={data} submit={submit} />}
    </div>
  );
}

type Sub = ReturnType<typeof useSubmit>;

function StudentView({ data, submit }: { data: SupData; submit: Sub }) {
  const [picked, setPicked] = useState<number[]>([]);
  const [confirm, setConfirm] = useState(false);
  const mentors = data.mentors ?? [];
  const round = data.round;
  const locked = data.myApplication?.status === 'submitted';
  const canFill = data.eligible && !locked && round?.type === 'supplementary' && round.status === 'open';

  async function send() {
    const ok = await submit.run('/flow/applications', {
      round_no: round?.round_no,
      mentor_ids: picked,
      accept_internal_transfer: true,
      accept_cross_lab_transfer: true,
      confirm: true,
    });
    if (ok) { setPicked([]); setConfirm(false); }
  }

  if (data.placement?.status === 'confirmed') {
    return (
      <section className="panel lift done">
        <h3><Icon name="checkCircle" size={14} /> 你已确认入组，补录不再开放</h3>
        <p className="hint">补录只对尚未入组的学生开放。</p>
      </section>
    );
  }

  return (
    <>
      <section className="panel lift">
        <h3><Icon name="info" size={14} /> 当前轮次</h3>
        <Line k="轮次" v={round ? `${round.name}（第 ${round.round_no} 轮 · ${round.type === 'supplementary' ? '补录' : '初选'}）` : '—'} />
        <Line k="轮次状态" v={round?.status === 'open' ? '开放填报中' : '尚未开放（等教务开启）'} />
        <Line k="我的补录志愿" v={locked ? `已提交（${new Date(data.myApplication!.submittedAt).toLocaleString('zh-CN')}）` : '未提交'} />
        <Line k="待确认去向" v={data.placement ? `有（${data.placement.status}）` : '无'} />
      </section>

      <section className="panel lift">
        <h3><Icon name="users" size={14} /> 可选导师与实时剩余名额</h3>
        {canFill ? (
          <div className="mentor-grid">
            {mentors.map((m) => {
              const on = picked.includes(m.id);
              const dim = !on && (picked.length >= 3 || m.remaining === 0);
              return (
                <button
                  key={m.id}
                  className={`mentor-chip lift ${on ? 'on' : ''} ${dim ? 'dim' : ''}`}
                  disabled={dim}
                  onClick={() => { setPicked((p) => (p.includes(m.id) ? p.filter((x) => x !== m.id) : [...p, m.id])); setConfirm(false); }}
                >
                  <span className="chip-mark">{on ? <Icon name="check" size={13} /> : <Icon name="plus" size={13} />}</span>
                  <span className="chip-name">{m.name}<em>{m.title || '导师'}</em></span>
                  <span className="chip-lab">{m.lab_name}</span>
                  <QuotaBar m={m} />
                </button>
              );
            })}
          </div>
        ) : (
          <table className="grid">
            <thead><tr><th>导师</th><th>实训室</th><th>名额</th><th>已占</th><th>剩余</th></tr></thead>
            <tbody>
              {mentors.map((m) => (
                <tr key={m.id}><td>{m.name}</td><td>{m.lab_name}</td><td>{m.quota}</td><td>{m.confirmed}</td><td className={m.remaining === 0 ? 'zero' : ''}>{m.remaining}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {!canFill && <p className="hint">{data.eligible ? '教务尚未开启补录轮次，或你的补录志愿已提交锁定。' : '你已不在补录范围内（已入组或已判未录取转线下）。'}</p>}
      </section>

      {canFill && (
        <section className="panel lift">
          <h3><Icon name="checkCircle" size={14} /> 提交补录志愿</h3>
          <Line k="已选导师" v={picked.length ? mentors.filter((m) => picked.includes(m.id)).map((m) => m.name).join('、') : '尚未选择'} />
          <p className="hint">补录默认两项服从调剂均为「服从」，沿用第 4 步面试成绩做名额匹配，不再重新面试。</p>
          <ConfirmCheck on={confirm} setOn={setConfirm} text="我确认补录志愿，提交后同样不可修改" />
          <Action busy={submit.busy} disabled={picked.length === 0 || !confirm} icon="pen" onClick={() => void send()}>提交补录志愿</Action>
        </section>
      )}
    </>
  );
}

function StaffView({ data, submit }: { data: SupData; submit: Sub }) {
  const rounds = (data.rounds ?? []).filter((r) => r.type === 'supplementary');
  const [roundNo, setRoundNo] = useState(rounds[0]?.round_no ?? 2);
  const mentors = data.mentors ?? [];
  const unplaced = data.unplaced ?? [];

  return (
    <>
      <section className="panel lift">
        <h3><Icon name="plus" size={14} /> 开启 / 关闭补录轮次</h3>
        <div className="flow-actions">
          <select className="mini" value={roundNo} onChange={(e) => setRoundNo(Number(e.target.value))}>
            {rounds.map((r) => <option key={r.id} value={r.round_no}>{r.name}（{r.status}）</option>)}
          </select>
          <Action
            busy={submit.busy}
            icon="check"
            onClick={() => void submit.run('/flow/supplementary/round', { round_no: roundNo })}
          >
            强制开启补录
          </Action>
          <Action
            busy={submit.busy}
            ghost
            icon="lock"
            onClick={() => void submit.run('/flow/supplementary/close', { round_no: roundNo })}
          >
            强制关闭补录
          </Action>
        </div>
        <p className="hint">开启：把第 6 步窗口强制打开并广播站内提示，学生可重新填报志愿（沿用第 4 步成绩，不重面试）。关闭：把轮次置为 closed 并强制关闭第 6 步窗口，学生不能再提交补录志愿。</p>
      </section>

      <section className="panel lift">
        <h3><Icon name="refresh" size={14} /> 执行补录匹配</h3>
        <p className="hint">按第 4 步最高分降序，依次把学生放进其志愿里仍有余位的导师；无余位则判未录取转线下。</p>
        <div className="flow-actions">
          <select className="mini" value={roundNo} onChange={(e) => setRoundNo(Number(e.target.value))}>
            {rounds.map((r) => <option key={r.id} value={r.round_no}>{r.name}</option>)}
          </select>
          <Action busy={submit.busy} icon="target" onClick={() => void submit.run('/flow/supplementary/match', { round_no: roundNo })}>
            跑第 {roundNo} 轮补录匹配
          </Action>
        </div>
      </section>

      <div className="two-col">
        <section className="panel lift">
          <h3><Icon name="cap" size={14} /> 尚未入组学生（{unplaced.length}）</h3>
          {unplaced.length === 0 ? <p className="empty">全部学生均已有去向。</p> : (
            <table className="grid">
              <thead><tr><th>学号</th><th>姓名</th><th>班级</th><th>状态</th></tr></thead>
              <tbody>
                {unplaced.map((s) => (
                  <tr key={s.id}><td>{s.student_no}</td><td>{s.name}</td><td>{s.class_name || '—'}</td><td><span className="tag">{s.status}</span></td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="panel lift">
          <h3><Icon name="ticket" size={14} /> 名额余量</h3>
          <table className="grid">
            <thead><tr><th>导师</th><th>实训室</th><th>名额</th><th>剩余</th></tr></thead>
            <tbody>
              {mentors.map((m) => (
                <tr key={m.id}><td>{m.name}</td><td>{m.lab_name}</td><td>{m.quota}</td><td className={m.remaining === 0 ? 'zero' : ''}>{m.remaining}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
