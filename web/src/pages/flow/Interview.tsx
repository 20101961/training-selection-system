import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/icons';
import type { StageWindow } from './shared';
import { Action, Line, Notice, StageBanner, useFlowData, useSubmit } from './shared';

interface Applicant {
  student_id: number;
  student_no: string;
  name: string;
  class_name: string | null;
  student_status: string;
  round_no: number;
  score: number | null;
  category: string | null;
}

interface InterviewData {
  stage: StageWindow;
  mentor: { id: number; name: string; quota: number; confirmed: number; remaining: number };
  unscored: number;
  listSubmitted: boolean;
  applicants: Applicant[];
}

export default function Interview() {
  const { data, error: loadErr, reload } = useFlowData<InterviewData>('/flow/interview');
  const submit = useSubmit(reload);
  const [scores, setScores] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});

  if (loadErr) return <div className="alert error">{loadErr}</div>;
  if (!data) return <div className="page-loading">加载我的志愿学生…</div>;

  function save(student: Applicant) {
    const raw = scores[student.student_id] ?? '';
    return submit.run('/flow/interview-scores', {
      student_id: student.student_id,
      round_id: student.round_no,
      score: Number(raw),
      note: notes[student.student_id] || null,
    }, () => setScores((p) => {
      const next = { ...p };
      delete next[student.student_id];
      return next;
    }));
  }

  async function saveAll() {
    const todo = data!.applicants.filter((a) => (scores[a.student_id] ?? '') !== '');
    if (todo.length === 0) {
      submit.setError('请先在表中填写分数（已打分的学生可用行内「更新打分」逐项修改）');
      return;
    }
    for (const a of todo) {
      if (!(await save(a))) return;
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>导师初选与面试</h2>
        <span className="hint">第 4 步 · 全员必面、逐一打分</span>
      </div>
      <StageBanner stage={data.stage} />
      <Notice error={submit.error} flash={submit.flash} />

      <section className="panel lift">
        <h3><Icon name="target" size={14} /> 我的名额与进度</h3>
        <div className="detail-grid">
          <Line k="硬名额（定量）" v={`${data.mentor.quota}`} />
          <Line k="已确认入组" v={`${data.mentor.confirmed}`} />
          <Line k="剩余名额" v={<strong className={data.mentor.remaining === 0 ? 'zero' : ''}>{data.mentor.remaining}</strong>} />
          <Line k="未打分人数" v={<strong className={data.unscored ? 'warn' : ''}>{data.unscored}</strong>} />
        </div>
        <p className="hint">
          {data.unscored > 0
            ? '尚有人未打分，不能把其列为拟录取（后端硬拦）。'
            : '全员已打分，可前往 '}
          {data.unscored === 0 && <Link className="link" to="/flow/candidate-lists">候选名单</Link>}
          {data.unscored === 0 && ' 提交拟录取 / 递补 / 内部调剂。'}
        </p>
        {data.listSubmitted && <p className="hint">名单已提交锁定，如需变更请找教务解锁。</p>}
      </section>

      <section className="panel lift">
        <h3><Icon name="list" size={14} /> 填报我的学生（{data.applicants.length} 人）</h3>
        {data.applicants.length === 0 ? (
          <p className="empty">本轮还没有学生把我填入志愿。</p>
        ) : (
          <table className="grid">
            <thead>
              <tr><th>学号</th><th>姓名</th><th>班级</th><th>轮次</th><th>面试分数</th><th>面试记录</th><th>当前名单</th><th>操作</th></tr>
            </thead>
            <tbody>
              {data.applicants.map((a) => (
                <tr key={a.student_id}>
                  <td>{a.student_no}</td>
                  <td>{a.name}</td>
                  <td>{a.class_name || '—'}</td>
                  <td>第 {a.round_no} 轮</td>
                  <td>
                    <input
                      className="mini score"
                      type="number"
                      min={0}
                      max={100}
                      step="0.5"
                      placeholder={a.score === null ? '待打分' : String(a.score)}
                      value={scores[a.student_id] ?? ''}
                      onChange={(e) => setScores((p) => ({ ...p, [a.student_id]: e.target.value }))}
                    />
                  </td>
                  <td>
                    <input
                      className="mini"
                      placeholder="面试记录（可选）"
                      value={notes[a.student_id] ?? ''}
                      onChange={(e) => setNotes((p) => ({ ...p, [a.student_id]: e.target.value }))}
                    />
                  </td>
                  <td><span className={`tag ${a.category || 'none'}`}>{CATEGORY[a.category || ''] || '未列入'}</span></td>
                  <td className="actions">
                    <button className="btn tiny" disabled={submit.busy} onClick={() => void save(a)}>
                      {a.score === null ? '保存打分' : '更新打分'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flow-actions">
          <Action busy={submit.busy} icon="check" onClick={() => void saveAll()}>批量保存已填分数</Action>
          <Link className="btn ghost" to="/flow/candidate-lists"><Icon name="list" size={14} /> 去提交候选名单</Link>
        </div>
      </section>
    </div>
  );
}

const CATEGORY: Record<string, string> = {
  admit: '拟录取',
  waitlist: '递补',
  internal_transfer: '内部调剂',
};
