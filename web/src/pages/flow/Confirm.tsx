import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/icons';
import type { StageWindow } from './shared';
import { Action, ConfirmCheck, Line, Notice, StageBanner, useFlowData, useSubmit } from './shared';

interface PendingRow {
  id: number;
  mentor_id: number;
  lab_id: number;
  source: string;
  created_at: string;
  mentor_name: string;
  mentor_code: string;
  lab_name: string;
}

interface ConfirmedRow {
  id: number;
  mentor_name: string | null;
  lab_name: string | null;
  source: string;
  confirmed_at: string;
}

interface ConfirmData {
  stage: StageWindow;
  student: { id: number; name: string; status: string };
  pending: PendingRow[];
  confirmed: ConfirmedRow | null;
}

const SOURCE: Record<string, string> = {
  admit_confirm: '导师拟录取',
  waitlist_promote: '递补顶岗',
  supplementary: '补录匹配',
  coordination: '统筹调剂',
  internal_transfer: '内部调剂',
  cross_lab_transfer: '跨室调剂',
  manual_backfill: '教务回填',
};

export default function Confirm() {
  const { data, error: loadErr, reload } = useFlowData<ConfirmData>('/flow/confirm');
  const submit = useSubmit(reload);
  const [pick, setPick] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);

  if (loadErr) return <div className="alert error">{loadErr}</div>;
  if (!data) return <div className="page-loading">加载我的拟录取…</div>;

  const chosen = data.pending.find((p) => p.id === pick) || null;

  async function send() {
    if (!pick) return;
    const ok = await submit.run('/flow/confirm', { placement_id: pick, confirm: true });
    if (ok) { setPick(null); setConfirm(false); }
  }

  async function decline(p: PendingRow) {
    const ok = await submit.run('/flow/decline', { placement_id: p.id, confirm: true });
    if (ok) { setPick(null); setConfirm(false); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>拟录取确认</h2>
        <span className="hint">第 5 步 · {data.student.name} · 状态 {data.student.status}</span>
      </div>
      <StageBanner stage={data.stage} />
      <Notice error={submit.error} flash={submit.flash} />

      {data.confirmed && (
        <section className="panel lift done">
          <h3><Icon name="checkCircle" size={14} /> 已确认唯一去向（确认即锁定，不可反悔）</h3>
          <div className="detail-grid">
            <Line k="录取导师" v={data.confirmed.mentor_name || '—'} />
            <Line k="所属实训室" v={data.confirmed.lab_name || '—'} />
            <Line k="来源" v={SOURCE[data.confirmed.source] ?? data.confirmed.source} />
            <Line k="确认时间" v={new Date(data.confirmed.confirmed_at).toLocaleString('zh-CN')} />
          </div>
          <p className="hint">后续进入第 8 步公示，公示满 1 天无异议自动生效入组；仅本人可在公示页申诉。</p>
          <div className="flow-actions"><Link className="btn ghost" to="/flow/publication"><Icon name="megaphone" size={14} /> 查看公示</Link></div>
        </section>
      )}

      {!data.confirmed && data.pending.length === 0 && (
        <section className="panel lift">
          <h3><Icon name="hourglass" size={14} /> 暂无待确认的拟录取</h3>
          <p className="hint">导师提交候选名单后，系统会在这里生成你的拟录取。仅 1 个拟录取时系统自动确认；≥2 个时需你亲自选唯一去向。</p>
          <div className="flow-actions">
            <Link className="btn ghost" to="/flow/fill"><Icon name="pen" size={14} /> 我的志愿</Link>
            <Link className="btn ghost" to="/flow/supplementary"><Icon name="plus" size={14} /> 补录通道</Link>
          </div>
        </section>
      )}

      {!data.confirmed && data.pending.length > 0 && (
        <section className="panel lift">
          <h3><Icon name="target" size={14} /> 待确认去向（{data.pending.length} 个拟录取）</h3>
          <div className="pick-grid">
            {data.pending.map((p) => {
              const on = pick === p.id;
              return (
                <button key={p.id} className={`pick-card lift ${on ? 'on' : ''}`} onClick={() => { setPick(p.id); setConfirm(false); }}>
                  <span className="pick-mark">{on ? <Icon name="check" size={13} /> : <Icon name="target" size={13} />}</span>
                  <span className="pick-title">{p.mentor_name}<em>{p.mentor_code}</em></span>
                  <span className="pick-sub">{p.lab_name}</span>
                  <span className="pick-src">{SOURCE[p.source] ?? p.source} · {new Date(p.created_at).toLocaleString('zh-CN')}</span>
                </button>
              );
            })}
          </div>
          {data.pending.length >= 2 && (
            <p className="hint">多录取必须只选一个：确认后其余拟录取自动释放，空位立即按各导师的递补预顺序顺延给下一名。</p>
          )}
          <p className="hint">确认瞬间服务器串行校验名额：若该导师名额刚被占满，本条会失效并提示你改选其他去向。</p>
        </section>
      )}

      {!data.confirmed && data.pending.length > 0 && (
        <section className="panel lift">
          <h3><Icon name="key" size={14} /> 确认操作</h3>
          <Line k="当前选择" v={chosen ? `${chosen.mentor_name} · ${chosen.lab_name}` : '尚未选择去向'} />
          <ConfirmCheck on={confirm} setOn={setConfirm} text="我确认该唯一去向，已知确认即锁定、不可反悔，其余拟录取将被释放递补" />
          <div className="flow-actions">
            <Action busy={submit.busy} disabled={!pick || !confirm} icon="check" onClick={() => void send()}>确认这个去向</Action>
            {data.pending.map((p) => (
              <button key={p.id} className="btn ghost" disabled={submit.busy} onClick={() => void decline(p)}>
                <Icon name="flag" size={14} /> 放弃 {p.mentor_name}
              </button>
            ))}
          </div>
          <p className="hint">全部放弃 = 转入未录取名单，可参加补录或由教务线下回填。</p>
        </section>
      )}
    </div>
  );
}
