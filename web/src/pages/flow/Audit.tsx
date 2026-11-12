import { useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import RosterImport from '../../components/RosterImport';
import type { MentorSlot } from './shared';
import { Action, ConfirmCheck, Notice, QuotaBar, useFlowData, useSubmit } from './shared';

interface Log {
  id: number;
  actor_role: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  student_id: number | null;
  student_no: string | null;
  student_name: string | null;
  detail: string | null;
  created_at: string;
}

interface Outcome {
  id: number;
  student_no: string;
  name: string;
  class_name: string | null;
  status: string;
  mentor_name: string | null;
  lab_name: string | null;
  source: string | null;
  placement_status: string | null;
  account_username: string | null;
  appeal_status: string | null;
  pending_offer: number;
}

interface Appeal {
  id: number;
  status: string;
  reason: string;
  resolution_note: string | null;
  created_at: string;
  handled_at: string | null;
  student_no: string;
  student_name: string;
  student_id: number;
  publication_id: number;
  publication_status: string;
  mentor_name: string | null;
  lab_name: string | null;
}

interface Application {
  id: number;
  status: string;
  submitted_at: string | null;
  student_no: string;
  student_name: string;
  student_status: string;
  mentors: string | null;
}

interface AuditData {
  logs: Log[];
  outcomes: Outcome[];
  appeals: Appeal[];
  byStatus: Record<string, string | number>;
}

interface AppsData {
  applications: Application[];
  mentors: MentorSlot[];
}

const STATUS_CN: Record<string, string> = {
  pending_fill: '待填报', filled: '已填报', interviewed: '已面试', pending_confirm: '待确认',
  confirmed: '已确认', published: '公示中', formal: '正式入组', unadmitted: '未录取(流程内)', failed: '未录取',
};

const ACTION_CN: Record<string, string> = {
  submit_application: '提交志愿', score_interview: '面试打分', submit_candidate_list: '提交候选名单',
  confirm_placement: '确认去向', decline_placement: '放弃去向', promote_waitlist: '递补顺延',
  open_supplementary_round: '开启补录轮', close_supplementary_round: '关闭补录轮', supplementary_match: '补录匹配', run_coordination: '执行统筹',
  coordination_assign: '统筹安置', internal_transfer_move: '内部换导师', publish_results: '发布公示',
  file_appeal: '学生申诉', appeal_upheld: '申诉成立', appeal_rejected: '申诉驳回',
  force_advance: '强制推进', unlock_application: '解锁志愿', unlock_candidate_list: '解锁名单',
  backfill_outcome: '回填去向', publication_effective: '公示生效', stage_window_changed: '时间窗变更',
  admin_reset_password: '重置学生密码', import_students: '导入名册', login: '登录', logout: '登出', change_password: '修改密码',
};

const PREVIEW = 5;
const needsBackfill = (o: Outcome) => o.placement_status !== 'confirmed' && o.status !== 'formal' && o.status !== 'failed';

export default function Audit() {
  const { data, error: loadErr, reload } = useFlowData<AuditData>('/flow/audit');
  const apps = useFlowData<AppsData>('/flow/applications');
  const submit = useSubmit(() => { reload(); apps.reload(); });
  const [mentorId, setMentorId] = useState<number | null>(null);
  const [unlockMentorId, setUnlockMentorId] = useState<number | null>(null);
  const [appId, setAppId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [backfill, setBackfill] = useState<Record<number, { outcome: string; mentor: number | '' }>>({});
  const [logsOpen, setLogsOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pwd, setPwd] = useState<Record<number, string>>({});
  const [acctOpen, setAcctOpen] = useState(false);
  const [acctQ, setAcctQ] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [backfillFilter, setBackfillFilter] = useState<'all' | 'need'>('need');
  const [appealNote, setAppealNote] = useState<Record<number, string>>({});
  const backfillRef = useRef<HTMLElement>(null);
  const accountRef = useRef<HTMLElement>(null);

  if (loadErr) return <div className="alert error">{loadErr}</div>;
  if (!data || !apps.data) return <div className="page-loading">加载审计台…</div>;

  const mentors = apps.data.mentors;
  const chosenMentor = mentors.find((m) => m.id === mentorId) || null;
  const outcomes = data.outcomes;

  const kw = q.trim().toLowerCase();
  const logs = kw
    ? data.logs.filter((l) =>
        [l.student_name, l.student_no, l.actor_name, l.actor_role, l.action, ACTION_CN[l.action], l.entity_type, l.detail]
          .filter(Boolean).join(' ').toLowerCase().includes(kw))
    : data.logs;
  const visibleLogs = logsOpen ? logs : logs.slice(0, PREVIEW);

  const akw = acctQ.trim().toLowerCase();
  const accounts = akw
    ? outcomes.filter((o) => [o.student_no, o.name, o.account_username ? '有账号' : '无账号'].join(' ').toLowerCase().includes(akw))
    : outcomes;
  const visibleAccounts = acctOpen ? accounts : accounts.slice(0, PREVIEW);

  const needRows = outcomes.filter(needsBackfill);
  const backfillRows = backfillFilter === 'need' ? needRows : outcomes;

  const appealUpheld = needRows.filter((o) => o.appeal_status === 'upheld');
  const unadmitted = needRows.filter((o) => o.status === 'unadmitted' && o.appeal_status !== 'upheld');
  const pendingAppeals = data.appeals.filter((a) => a.status === 'pending');
  const pendingConfirm = outcomes.filter((o) => o.pending_offer > 0);
  const noAccount = outcomes.filter((o) => !o.account_username);
  const specialTotal = appealUpheld.length + unadmitted.length + pendingAppeals.length + pendingConfirm.length + noAccount.length;

  function gotoBackfill() {
    setBackfillFilter('need');
    backfillRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function gotoAccount(no?: string) {
    setAcctOpen(true);
    setAcctQ(no ?? '');
    accountRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function forceAdvance() {
    if (!mentorId) { submit.setError('请先选择要强制推进的导师'); return; }
    await submit.run('/flow/force-advance', { mentor_id: mentorId });
  }
  async function unlock(kind: 'application' | 'candidate_list', id: number) {
    await submit.run('/flow/unlock', { kind, id });
  }
  async function sendBackfill(studentId: number) {
    const row = backfill[studentId] || { outcome: '', mentor: '' };
    await submit.run('/flow/backfill', { student_id: studentId, outcome: row.outcome, mentor_id: row.mentor || null });
  }
  async function resetPwd(studentId: number) {
    const ok = await submit.run('/auth/admin/student-password', { student_id: studentId, password: pwd[studentId] || '' });
    if (ok) setPwd((p) => ({ ...p, [studentId]: '' }));
  }
  async function handleAppeal(id: number, decision: 'upheld' | 'rejected') {
    await submit.run(`/flow/appeals/${id}/handle`, { decision, note: appealNote[id] || null });
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>审计与回填</h2>
        <span className="hint">全程留痕 · 教务应急：特殊情况 / 强制推进 / 解锁 / 线下回填 / 账号 / 名册导入</span>
      </div>
      <Notice error={submit.error} flash={submit.flash} />

      <section className="panel lift">
        <h3><Icon name="pie" size={14} /> 学生状态分布</h3>
        <div className="status-summary">
          {Object.entries(data.byStatus).map(([k, v]) => (
            <span className="stat-chip lift" key={k}>{STATUS_CN[k] ?? k}<em>{v}</em></span>
          ))}
        </div>
      </section>

      <section className="panel lift">
        <h3><Icon name="alert" size={14} /> 特殊情况速览（申诉 / 落榜 / 待确认 / 无账号）</h3>
        {specialTotal === 0 ? (
          <p className="empty">当前无待处理的特殊情况：所有学生均已安置或已确认，无待裁决申诉。</p>
        ) : (
          <div className="special-grid">
            <div className="special-card appeal">
              <h4><Icon name="flag" size={13} /> 申诉成立 · 待回填 <em>{appealUpheld.length}</em></h4>
              {appealUpheld.length === 0 ? <p className="empty">无</p> : (
                <ul className="special-list">
                  {appealUpheld.map((o) => (
                    <li key={o.id}><span>{o.name}（{o.student_no}）</span><button className="btn tiny" onClick={gotoBackfill}>去回填</button></li>
                  ))}
                </ul>
              )}
              <p className="hint">异议成立后公示已移除、去向释放，需教务线下回填正式入组或确定未录取。</p>
            </div>

            <div className="special-card warn">
              <h4><Icon name="hourglass" size={13} /> 落榜 / 未录取 · 待回填 <em>{unadmitted.length}</em></h4>
              {unadmitted.length === 0 ? <p className="empty">无</p> : (
                <ul className="special-list">
                  {unadmitted.map((o) => (
                    <li key={o.id}><span>{o.name}（{o.student_no}）</span><button className="btn tiny" onClick={gotoBackfill}>去回填</button></li>
                  ))}
                </ul>
              )}
              <p className="hint">流程内未录取者，可在下方去向总表回填终态。</p>
            </div>

            <div className="special-card info">
              <h4><Icon name="megaphone" size={13} /> 申诉待裁决 <em>{pendingAppeals.length}</em></h4>
              {pendingAppeals.length === 0 ? <p className="empty">无</p> : (
                <ul className="special-list appeals">
                  {pendingAppeals.map((a) => (
                    <li key={a.id}>
                      <div className="appeal-line">
                        <span>{a.student_name}（{a.student_no}）</span>
                        <span className="hint">原公示：{a.mentor_name || '—'} / {a.lab_name || '—'}</span>
                      </div>
                      <p className="appeal-reason">理由：{a.reason}</p>
                      <div className="appeal-actions">
                        <input className="mini wide" type="text" placeholder="裁决备注（可选）" value={appealNote[a.id] ?? ''} onChange={(e) => setAppealNote((p) => ({ ...p, [a.id]: e.target.value }))} />
                        <button className="btn tiny" disabled={submit.busy} onClick={() => void handleAppeal(a.id, 'upheld')}>申诉成立</button>
                        <button className="btn tiny ghost" disabled={submit.busy} onClick={() => void handleAppeal(a.id, 'rejected')}>驳回</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="hint">成立 → 移除公示并释放去向（转上方待回填）；驳回 → 维持原公示。</p>
            </div>

            <div className="special-card ok">
              <h4><Icon name="clock" size={13} /> 待确认 offer <em>{pendingConfirm.length}</em></h4>
              {pendingConfirm.length === 0 ? <p className="empty">无</p> : (
                <ul className="special-list">
                  {pendingConfirm.map((o) => (
                    <li key={o.id}><span>{o.name}（{o.student_no}）</span><span className="tag pending_confirm">拟录取待确认</span></li>
                  ))}
                </ul>
              )}
              <p className="hint">导师已发拟录取，等学生本人确认；放弃则释放名额并递补。</p>
            </div>

            <div className="special-card muted">
              <h4><Icon name="key" size={13} /> 无登录账号 <em>{noAccount.length}</em></h4>
              {noAccount.length === 0 ? <p className="empty">无</p> : (
                <ul className="special-list">
                  {noAccount.map((o) => (
                    <li key={o.id}><span>{o.name}（{o.student_no}）</span><button className="btn tiny" onClick={() => gotoAccount(o.student_no)}>去建号</button></li>
                  ))}
                </ul>
              )}
              <p className="hint">可在下方账号面板逐个建号，或上传名册批量建号。</p>
            </div>
          </div>
        )}
      </section>

      <section className="panel lift">
        <h3><Icon name="zap" size={14} /> 应急：导师逾期未提交名单 → 按成绩强制推进</h3>
        <div className="flow-actions">
          <select className="mini" value={mentorId ?? ''} onChange={(e) => { setMentorId(Number(e.target.value) || null); setConfirm(false); }}>
            <option value="">选择导师</option>
            {mentors.map((m) => <option key={m.id} value={m.id}>{m.name}（{m.lab_name} · 余 {m.remaining}）</option>)}
          </select>
          <ConfirmCheck on={confirm} setOn={setConfirm} text="我确认代该导师出名单：仅取已打分学生，按分数降序填满硬名额，其余进递补" />
          <Action busy={submit.busy} disabled={!mentorId || !confirm} icon="refresh" onClick={() => void forceAdvance()}>执行强制推进</Action>
        </div>
        {chosenMentor && (
          <p className="hint">
            目标导师：{chosenMentor.name} · 硬名额 {chosenMentor.quota} · 已确认 {chosenMentor.confirmed} · <QuotaBar m={chosenMentor} />
          </p>
        )}
      </section>

      <section className="panel lift">
        <h3><Icon name="key" size={14} /> 应急：退回解锁</h3>
        <p className="hint">「提交后还想改」的救急通道：把已提交、但尚未确认的记录退回到可编辑状态，让本人重新来过。已确认入组的去向不受影响。</p>
        <div className="unlock-grid">
          <div className="unlock-card">
            <div className="unlock-head"><Icon name="pen" size={13} /> 退回学生志愿</div>
            <p className="unlock-when"><strong>何时用：</strong>学生志愿填错、填早了想改，或填报窗口已关但有正当理由需重填。退回后该生志愿恢复可编辑，可修改并重新提交。</p>
            <div className="flow-actions">
              <select className="mini" value={appId ?? ''} onChange={(e) => setAppId(Number(e.target.value) || null)}>
                <option value="">选择志愿记录</option>
                {apps.data.applications.map((a) => (
                  <option key={a.id} value={a.id}>#{a.id} {a.student_name}（{a.student_no}）· {a.status} · {a.mentors || '无志愿'}</option>
                ))}
              </select>
              <button className="btn" disabled={submit.busy || !appId} onClick={() => void unlock('application', appId!)}>退回学生志愿</button>
            </div>
          </div>
          <div className="unlock-card">
            <div className="unlock-head"><Icon name="list" size={13} /> 解锁候选名单</div>
            <p className="unlock-when"><strong>何时用：</strong>导师的打分 / 候选名单提交早了或有误，需在学生确认前修改。解锁会清除该导师「未确认」的候选记录，导师可重新打分、重新选人。</p>
            <div className="flow-actions">
              <select className="mini" value={unlockMentorId ?? ''} onChange={(e) => setUnlockMentorId(Number(e.target.value) || null)}>
                <option value="">选择导师（解锁已提交名单）</option>
                {mentors.map((m) => <option key={m.id} value={m.id}>{m.name}（{m.lab_name}）</option>)}
              </select>
              <button className="btn" disabled={submit.busy || !unlockMentorId} onClick={() => void unlock('candidate_list', unlockMentorId!)}>解锁候选名单</button>
            </div>
          </div>
        </div>
        <p className="hint">安全边界：解锁只清除未确认的记录；已确认入组的学生去向保留，防止误删既成事实。</p>
      </section>

      <section className="panel lift" ref={accountRef}>
        <div className="panel-head">
          <h3><Icon name="user" size={14} /> 应急：学生账号（重置 / 创建密码）</h3>
          <div className="panel-tools">
            <input className="mini search" type="search" value={acctQ} placeholder="搜索学号 / 姓名 / 账号" onChange={(e) => setAcctQ(e.target.value)} />
            <button className="btn tiny ghost" onClick={() => setAcctOpen((v) => !v)}>{acctOpen ? '收起' : '展开'}</button>
          </div>
        </div>
        <p className="hint">为已有学生设置登录密码：有账号则重置，无账号则按学号自动创建。重置后该生旧会话立即失效，须用新密码重新登录。密码至少 6 位。</p>
        {visibleAccounts.length === 0 ? <p className="empty">{akw ? '没有匹配的学生。' : '暂无学生。'}</p> : (
          <table className="grid">
            <thead><tr><th>学号</th><th>姓名</th><th>账号</th><th>新密码</th><th>操作</th></tr></thead>
            <tbody>
              {visibleAccounts.map((o) => {
                const pw = pwd[o.id] ?? '';
                return (
                  <tr key={o.id}>
                    <td>{o.student_no}</td>
                    <td>{o.name}</td>
                    <td>{o.account_username ? <span className="tag">有账号</span> : <span className="tag failed">无账号</span>}</td>
                    <td><input className="mini" type="text" value={pw} placeholder="≥6 位" onChange={(e) => setPwd((p) => ({ ...p, [o.id]: e.target.value }))} /></td>
                    <td className="actions">
                      <button className="btn tiny" disabled={submit.busy || pw.length < 6} onClick={() => void resetPwd(o.id)}>{o.account_username ? '重置密码' : '创建账号'}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!acctOpen && accounts.length > PREVIEW && (
          <p className="preview-note">已折叠 · 仅显示前 {PREVIEW} 人，共 {accounts.length} 人 · <button className="linklike" onClick={() => setAcctOpen(true)}>展开全部</button></p>
        )}
        <div className="import-toggle">
          <button className="btn ghost" onClick={() => setImportOpen((v) => !v)}>
            <Icon name="upload" size={14} /> {importOpen ? '收起名册导入' : '上传名册批量建号（CSV）'}
          </button>
          <span className="hint">不知道学生有谁？上传教务名册即可批量登记学生并按学号建号。</span>
        </div>
        {importOpen && <RosterImport onImported={() => { reload(); apps.reload(); }} />}
      </section>

      <section className="panel lift" ref={backfillRef}>
        <div className="panel-head">
          <h3><Icon name="fileText" size={14} /> 去向总表与线下回填（落榜 / 异议成立者）</h3>
          <div className="seg-row">
            <Icon name="filter" size={13} />
            <button className={`seg ${backfillFilter === 'all' ? 'on' : ''}`} onClick={() => setBackfillFilter('all')}>全部 {outcomes.length}</button>
            <button className={`seg ${backfillFilter === 'need' ? 'on' : ''}`} onClick={() => setBackfillFilter('need')}>仅需回填 {needRows.length}</button>
          </div>
        </div>
        <p className="hint">只有「无确认去向」者（未录取 / 落榜 / 异议成立）可回填；已入组者锁定，如需改判请先在统筹或解锁中释放去向。</p>
        {backfillRows.length === 0 ? <p className="empty">{backfillFilter === 'need' ? '太棒了，当前没有需要回填的学生。' : '暂无学生。'}</p> : (
          <table className="grid">
            <thead><tr><th>学号</th><th>姓名</th><th>班级</th><th>状态</th><th>导师 / 实训室</th><th>来源</th><th>回填</th></tr></thead>
            <tbody>
              {backfillRows.map((o) => {
                const row = backfill[o.id] || { outcome: '', mentor: '' };
                const placed = o.placement_status === 'confirmed';
                return (
                  <tr key={o.id} className={placed ? 'row-muted' : ''}>
                    <td>{o.student_no}</td>
                    <td>{o.name}</td>
                    <td>{o.class_name || '—'}</td>
                    <td>
                      <span className={`tag ${o.status}`}>{STATUS_CN[o.status] ?? o.status}</span>
                      {o.appeal_status === 'upheld' && <span className="tag appealed" title="申诉成立，公示已移除">申诉成立</span>}
                    </td>
                    <td>{o.mentor_name ? `${o.mentor_name} / ${o.lab_name}` : '—'}</td>
                    <td className="hint">{o.source || '—'}</td>
                    <td className="actions">
                      {placed ? (
                        <span className="hint">已入组 · 无需回填</span>
                      ) : (
                        <>
                          <select
                            className="mini"
                            value={row.outcome}
                            onChange={(e) => setBackfill((p) => ({ ...p, [o.id]: { ...row, outcome: e.target.value } }))}
                          >
                            <option value="">选择</option>
                            <option value="formal">正式入组</option>
                            <option value="failed">确定未录取</option>
                          </select>
                          {row.outcome === 'formal' && (
                            <select
                              className="mini"
                              value={row.mentor === '' ? '' : row.mentor}
                              onChange={(e) => setBackfill((p) => ({ ...p, [o.id]: { ...row, mentor: Number(e.target.value) || '' } }))}
                            >
                              <option value="">目标导师</option>
                              {mentors.filter((m) => m.remaining > 0).map((m) => <option key={m.id} value={m.id}>{m.name}（余 {m.remaining}）</option>)}
                            </select>
                          )}
                          <button
                            className="btn tiny"
                            disabled={submit.busy || !row.outcome || (row.outcome === 'formal' && !row.mentor)}
                            onClick={() => void sendBackfill(o.id)}
                          >回填</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="hint">回填为「正式入组」会立即生成已生效公示并占用名额；终态只有 formal / failed 两种。</p>
      </section>

      <section className="panel lift">
        <div className="panel-head">
          <h3><Icon name="search" size={14} /> 审计流水（{logs.length}/{data.logs.length} 条）</h3>
          <div className="panel-tools">
            <input className="mini search" type="search" value={q} placeholder="搜索学生 / 操作者 / 动作 / 详情" onChange={(e) => setQ(e.target.value)} />
            <button className="btn tiny ghost" onClick={() => setLogsOpen((v) => !v)}>{logsOpen ? '收起' : '展开'}</button>
          </div>
        </div>
        {visibleLogs.length === 0 ? <p className="empty">{kw ? '没有匹配的审计记录。' : '暂无审计记录。'}</p> : (
          <table className="grid">
            <thead><tr><th>#</th><th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>学生</th><th>详情</th></tr></thead>
            <tbody>
              {visibleLogs.map((l) => (
                <tr key={l.id}>
                  <td>{l.id}</td>
                  <td className="hint">{new Date(l.created_at).toLocaleString('zh-CN')}</td>
                  <td>{l.actor_name || l.actor_role || '系统'}</td>
                  <td><code>{l.action}</code><span className="hint"> {ACTION_CN[l.action] || ''}</span></td>
                  <td className="hint">{l.entity_type || '—'}{l.entity_id != null ? ` #${l.entity_id}` : ''}</td>
                  <td>{l.student_name ? `${l.student_name}（${l.student_no}）` : '—'}</td>
                  <td className="detail-cell hint">{l.detail ? short(l.detail) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!logsOpen && logs.length > PREVIEW && (
          <p className="preview-note">已折叠 · 仅显示前 {PREVIEW} 条，共 {logs.length} 条 · <button className="linklike" onClick={() => setLogsOpen(true)}>展开全部</button></p>
        )}
      </section>
    </div>
  );
}

function short(json: string) {
  return json.length > 120 ? `${json.slice(0, 120)}…` : json;
}
