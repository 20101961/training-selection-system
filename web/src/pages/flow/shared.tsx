import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../../api/client';
import { Icon } from '../../components/icons';

export interface StageWindow {
  stageNo: number;
  code: string;
  name: string;
  effective: string;
  opensAt: string;
  closesAt: string;
}

export interface MentorSlot {
  id: number;
  code: string;
  name: string;
  title: string | null;
  lab_id: number;
  lab_name: string;
  quota: number;
  confirmed: number;
  remaining: number;
}

const STAGE_LABEL: Record<string, string> = { pending: '未开始', open: '开放中', closed: '已关闭' };

export function useFlowData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    api<T>(path)
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, loading, reload, setError };
}

// 统一提交动作：busy 期间禁用，成功后刷新并回调，失败把后端中文原因显示出来。
export function useSubmit(reload: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');

  async function run<T>(path: string, body: unknown, onOk?: (out: T) => void): Promise<boolean> {
    setBusy(true);
    setError('');
    setFlash('');
    try {
      const out = await api<T>(path, { method: 'POST', body });
      setFlash('操作已完成');
      onOk?.(out);
      reload();
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '操作失败');
      reload();
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, flash, run, setError, setFlash };
}

export function StageBanner({ stage }: { stage?: StageWindow | null }) {
  if (!stage) return null;
  return (
    <div className={`current-stage ${stage.effective}`}>
      阶段窗口：<strong>第 {stage.stageNo} 步 · {stage.name}</strong>
      <span className={`pill ${stage.effective}`}>{STAGE_LABEL[stage.effective] ?? stage.effective}</span>
      <span className="window">
        {new Date(stage.opensAt).toLocaleString('zh-CN')} → {new Date(stage.closesAt).toLocaleString('zh-CN')}
      </span>
      {stage.effective !== 'open' && <span className="hint">窗口未开放，提交将被服务器拦截（以服务器时间为准）</span>}
    </div>
  );
}

export function Action({
  busy,
  disabled,
  onClick,
  icon,
  children,
  ghost,
}: {
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon?: string;
  children: ReactNode;
  ghost?: boolean;
}) {
  return (
    <button className={`btn ${ghost ? 'ghost' : 'primary'}`} disabled={disabled || busy} onClick={onClick}>
      {busy ? <span className="spinner" /> : icon ? <Icon name={icon} size={15} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function ConfirmCheck({
  on,
  setOn,
  text,
}: {
  on: boolean;
  setOn: (v: boolean) => void;
  text: string;
}) {
  return (
    <label className={`confirm-check ${on ? 'on' : ''}`}>
      <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
      <span className="box"><Icon name="check" size={12} /></span>
      <span className="txt">{text}</span>
    </label>
  );
}

export function Notice({ error, flash }: { error?: string; flash?: string }) {
  return (
    <>
      {error && <div className="alert error"><Icon name="flag" size={14} /> {error}</div>}
      {flash && <div className="alert ok"><Icon name="checkCircle" size={14} /> {flash}</div>}
    </>
  );
}

export function QuotaBar({ m }: { m: MentorSlot }) {
  return (
    <span className={`quota-bar ${m.remaining === 0 ? 'full' : ''}`}>
      {m.confirmed}/{m.quota}
    </span>
  );
}

export function Line({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="detail-line">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}
