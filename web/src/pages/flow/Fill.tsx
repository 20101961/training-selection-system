import { useMemo, useRef, useState } from 'react';
import { api, downloadFile } from '../../api/client';
import { Icon } from '../../components/icons';
import type { MentorSlot, StageWindow } from './shared';
import { Action, ConfirmCheck, Line, Notice, QuotaBar, StageBanner, useFlowData, useSubmit } from './shared';

interface Attachment {
  id: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

interface FillData {
  stage: StageWindow;
  round: { id: number; roundNo: number; type: string; name: string; status: string };
  student: { id: number; name: string; status: string };
  application: {
    id: number;
    status: string;
    submittedAt: string;
    choices: number[];
    acceptInternalTransfer: boolean;
    acceptCrossLabTransfer: boolean;
  } | null;
  mentors: MentorSlot[];
  attachments: Attachment[];
}

const STATUS_TEXT: Record<string, string> = {
  pending_fill: '待填报',
  filled: '已填报志愿',
  interviewed: '已面试',
  pending_confirm: '待确认去向',
  confirmed: '已确认入组',
  published: '公示中',
  formal: '正式入组',
  unadmitted: '暂未被录取',
  failed: '未录取',
};

const MAX_FILES = 5;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp,.zip,.rar,.7z,.txt,.md,.csv';

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default function Fill() {
  const { data, error: loadErr, reload } = useFlowData<FillData>('/flow/applications');
  const submit = useSubmit(reload);
  const [picked, setPicked] = useState<number[]>([]);
  const [internal, setInternal] = useState(true);
  const [cross, setCross] = useState(false);
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const mentors = data?.mentors ?? [];
  const attachments = data?.attachments ?? [];
  const chosen = useMemo(
    () => mentors.filter((m) => picked.includes(m.id)),
    [mentors, picked]
  );

  if (loadErr) return <div className="alert error">{loadErr}</div>;
  if (!data) return <div className="page-loading">加载志愿表…</div>;

  const locked = data.application?.status === 'submitted';
  const full = attachments.length >= MAX_FILES;

  function toggle(id: number) {
    setPreview(false);
    setConfirm(false);
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 3 ? prev : [...prev, id]
    );
  }

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0 || locked || uploading) return;
    const files = Array.from(list);
    setUploadErr('');
    const room = MAX_FILES - attachments.length;
    if (files.length > room) {
      setUploadErr(`最多 ${MAX_FILES} 个附件，当前还能上传 ${room} 个`);
      return;
    }
    for (const f of files) {
      if (f.size === 0) { setUploadErr(`「${f.name}」是空文件`); return; }
      if (f.size > MAX_BYTES) { setUploadErr(`「${f.name}」超过 5MB 上限`); return; }
    }
    setUploading(true);
    try {
      for (const f of files) {
        const b64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
          r.onerror = () => reject(new Error(`「${f.name}」读取失败`));
          r.readAsDataURL(f);
        });
        await api('/flow/attachments', { method: 'POST', body: { filename: f.name, content_base64: b64 } });
      }
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
      reload();
    }
  }

  async function removeAttach(id: number) {
    setUploadErr('');
    try {
      await api(`/flow/attachments/${id}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : '删除失败');
    }
  }

  async function downloadAttach(a: Attachment) {
    setUploadErr('');
    try {
      await downloadFile(`/flow/attachments/${a.id}/download`, a.filename);
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : '下载失败');
    }
  }

  async function send() {
    const ok = await submit.run('/flow/applications', {
      mentor_ids: picked,
      accept_internal_transfer: internal,
      accept_cross_lab_transfer: cross,
      confirm: true,
    });
    if (ok) {
      setPreview(false);
      setConfirm(false);
      setPicked([]);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>意向填报</h2>
        <span className="hint">第 3 步 · {data.round.name} · 我的状态：{STATUS_TEXT[data.student.status] ?? data.student.status}</span>
      </div>
      <StageBanner stage={data.stage} />
      <Notice error={submit.error} flash={submit.flash} />

      {locked ? (
        <section className="panel lift">
          <h3><Icon name="checkCircle" size={14} /> 志愿已提交锁定（提交即定，不可修改）</h3>
          <Line k="提交时间" v={new Date(data.application!.submittedAt).toLocaleString('zh-CN')} />
          <Line k="导师志愿" v={mentors.filter((m) => data.application!.choices.includes(m.id)).map((m) => `${m.name}（${m.lab_name}）`).join('、') || '—'} />
          <Line k="服从实训室内部调剂" v={data.application!.acceptInternalTransfer ? '是' : '否'} />
          <Line k="服从跨实训室调剂" v={data.application!.acceptCrossLabTransfer ? '是' : '否'} />
          <p className="hint">如需更正，请携带理由联系教务，由教务在「审计与回填」页退回解锁后重新填报。</p>
        </section>
      ) : (
        <>
          <section className="panel lift">
            <h3><Icon name="users" size={14} /> 选择导师志愿（最多 3 个 · 平行志愿不分先后）</h3>
            <div className="mentor-grid">
              {mentors.map((m) => {
                const on = picked.includes(m.id);
                const blocked = !on && picked.length >= 3;
                return (
                  <button
                    key={m.id}
                    className={`mentor-chip lift ${on ? 'on' : ''} ${blocked ? 'dim' : ''}`}
                    onClick={() => toggle(m.id)}
                    disabled={blocked}
                  >
                    <span className="chip-mark">{on ? <Icon name="check" size={13} /> : <Icon name="plus" size={13} />}</span>
                    <span className="chip-name">{m.name}<em>{m.title || '导师'}</em></span>
                    <span className="chip-lab">{m.lab_name}</span>
                    <QuotaBar m={m} />
                  </button>
                );
              })}
            </div>
            <p className="hint">已选 {picked.length}/3 · 平行志愿不分先后，志愿之间无优先级；名额已满的导师无法产生拟录取。</p>
          </section>

          <section className="panel lift">
            <h3><Icon name="refresh" size={14} /> 调剂意愿（两个勾选彼此独立）</h3>
            <div className="check-row">
              <label className={`switch ${internal ? 'on' : ''}`}>
                <input type="checkbox" checked={internal} onChange={(e) => { setInternal(e.target.checked); setPreview(false); }} />
                <span className="track"><span className="knob" /></span>
                <span className="txt">服从实训室内部调剂<small>仅在同实训室换导师，绝不跨室</small></span>
              </label>
              <label className={`switch ${cross ? 'on' : ''}`}>
                <input type="checkbox" checked={cross} onChange={(e) => { setCross(e.target.checked); setPreview(false); }} />
                <span className="track"><span className="knob" /></span>
                <span className="txt">服从跨实训室调剂<small>可调整至其他实训室的导师</small></span>
              </label>
            </div>
            <p className="hint">两项都不勾选 = 只接受自己填报的导师；统筹阶段将被直接判为未录取并转线下。</p>
          </section>
        </>
      )}

      <section className="panel lift">
        <h3><Icon name="paperclip" size={14} /> 附件材料（可选 · 获奖证明 / 成绩单 / 作品等）</h3>
        {locked ? (
          <p className="hint">志愿已锁定，附件随志愿一并封存，仅可下载查看。</p>
        ) : (
          <div
            className={`dropzone ${dragOver ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); if (!full && !uploading) setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!full) handleFiles(e.dataTransfer.files); }}
          >
            <Icon name="fileText" size={24} />
            <p>{full ? `已达 ${MAX_FILES} 个附件上限，删除后可继续添加` : '拖拽文件到此处，或'}</p>
            {!full && (
              <button className="btn ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <span className="spinner" /> : <Icon name="plus" size={13} />}
                {uploading ? '上传中…' : '选择文件'}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              multiple
              className="file-input"
              accept={ACCEPT}
              onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
            />
            <span className="hint">文档 / 表格 / 演示 / 图片 / 压缩包 / 文本 · 单个 ≤5MB · 最多 {MAX_FILES} 个 · 已传 {attachments.length}/{MAX_FILES}</span>
          </div>
        )}
        {uploadErr && <div className="alert error" style={{ marginTop: 10 }}>{uploadErr}</div>}
        {attachments.length > 0 ? (
          <ul className="attach-list">
            {attachments.map((a) => (
              <li key={a.id}>
                <Icon name="fileText" size={15} />
                <span className="attach-name" title={a.filename}>{a.filename}</span>
                <span className="attach-size">{fmtSize(a.sizeBytes)}</span>
                <button className="btn tiny ghost" onClick={() => downloadAttach(a)}>
                  <Icon name="download" size={12} /> 下载
                </button>
                {!locked && (
                  <button className="btn tiny ghost danger" onClick={() => removeAttach(a.id)}>
                    <Icon name="trash" size={12} /> 删除
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          locked && <p className="empty">未上传附件</p>
        )}
      </section>

      {!locked && (
        <section className="panel lift">
          <h3><Icon name="eye" size={14} /> 预览与二次确认</h3>
          {!preview ? (
            <Action busy={submit.busy} disabled={picked.length === 0} icon="search" onClick={() => setPreview(true)}>
              生成提交预览
            </Action>
          ) : (
            <div className="preview-box">
              <Line k="轮次" v={data.round.name} />
              <Line k="志愿导师" v={chosen.map((m) => `${m.name}（${m.lab_name} · 剩余 ${m.remaining}）`).join('、')} />
              <Line k="内部调剂" v={internal ? '服从' : '不服从'} />
              <Line k="跨室调剂" v={cross ? '服从' : '不服从'} />
              <Line k="附件" v={attachments.length ? attachments.map((a) => a.filename).join('、') : '无'} />
              <ConfirmCheck
                on={confirm}
                setOn={setConfirm}
                text="我已逐字核对以上内容，确认提交即定、不可修改（如需变更须教务解锁）"
              />
              <Action busy={submit.busy} disabled={!confirm} icon="pen" onClick={send}>
                确认提交志愿
              </Action>
              <p className="hint">后端会再次校验：志愿数 ≤3、二次确认必勾、窗口开放、无重复提交。</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}