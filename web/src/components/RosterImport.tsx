import { useRef, useState } from 'react';
import { api } from '../api/client';
import { Icon } from './icons';

interface ParsedRow {
  student_no: string;
  name: string;
  class_name: string;
  contact: string;
}

interface ImportResult {
  batchId: number;
  createdStudents: number;
  updatedStudents: number;
  createdAccounts: number;
  existingAccounts: number;
  errors: string[];
}

const TEMPLATE =
  '学号,姓名,班级,联系方式\n' +
  '2024009,张三,软件2401,13800000009\n' +
  '2024010,李四,软件2402,13800000010\n' +
  '2024011,王五,网络2401,13800000011\n';

const PREVIEW_ROWS = 8;

// 解析单行 CSV，支持双引号包裹与转义 ("")。
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCSV(text: string): ParsedRow[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).filter((l) => l.trim().length);
  if (!lines.length) return [];
  const first = splitLine(lines[0]);
  const hasHeader = first.some((f) => /学号|student_?no|编号/i.test(f)) && first.some((f) => /姓名|name|名字/i.test(f));
  const idx = { student_no: 0, name: 1, class_name: 2, contact: 3 };
  let dataLines = lines;
  if (hasHeader) {
    idx.student_no = -1; idx.name = -1; idx.class_name = -1; idx.contact = -1;
    first.forEach((f, i) => {
      if (/学号|student_?no|编号/i.test(f)) idx.student_no = i;
      else if (/姓名|name|名字/i.test(f)) idx.name = i;
      else if (/班级|class/i.test(f)) idx.class_name = i;
      else if (/联系|电话|手机|contact|phone/i.test(f)) idx.contact = i;
    });
    dataLines = lines.slice(1);
  }
  const get = (f: string[], i: number) => (i >= 0 && i < f.length ? f[i] : '');
  return dataLines.map((line) => {
    const f = splitLine(line);
    return {
      student_no: get(f, idx.student_no),
      name: get(f, idx.name),
      class_name: get(f, idx.class_name),
      contact: get(f, idx.contact),
    };
  });
}

export default function RosterImport({ onImported }: { onImported?: () => void }) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [filename, setFilename] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [createAccounts, setCreateAccounts] = useState(true);
  const [defaultPassword, setDefaultPassword] = useState('123456');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const valid = rows.filter((r) => r.student_no && r.name);
  const invalidCount = rows.length - valid.length;
  const canImport = valid.length > 0 && (!createAccounts || defaultPassword.length >= 6) && !busy;

  async function handleFile(f: File | undefined | null) {
    if (!f) return;
    setErr('');
    setResult(null);
    if (!/\.(csv|txt)$/i.test(f.name)) {
      setErr('请上传 CSV 文本（Excel 可「另存为 → CSV UTF-8」后再上传）。');
      return;
    }
    if (f.size > 2 * 1024 * 1024) { setErr('文件超过 2MB，请拆分后上传。'); return; }
    try {
      const text = await f.text();
      const parsed = parseCSV(text);
      if (!parsed.length) { setErr('未解析到数据行，请检查文件内容与表头。'); return; }
      setRows(parsed);
      setFilename(f.name);
    } catch {
      setErr('文件读取失败，请重试。');
    }
  }

  function downloadTemplate() {
    const blob = new Blob(['\uFEFF' + TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '学生名册模板.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function doImport() {
    if (!canImport) return;
    setBusy(true);
    setErr('');
    try {
      const out = await api<ImportResult>('/base/students/import', {
        method: 'POST',
        body: { filename, rows: valid, create_accounts: createAccounts, default_password: defaultPassword },
      });
      setResult(out);
      setRows([]);
      setFilename('');
      onImported?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '导入失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="roster-import">
      <div
        className={`dropzone ${dragOver ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void handleFile(e.dataTransfer.files?.[0]); }}
      >
        <Icon name="upload" size={24} />
        <p>{filename ? `已选择：${filename}（${rows.length} 行）` : '拖拽名册 CSV 到此处，或'}</p>
        <button className="btn ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Icon name="folder" size={13} /> 选择文件
        </button>
        <input
          ref={fileRef}
          type="file"
          className="file-input"
          accept=".csv,.txt"
          onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ''; }}
        />
        <span className="hint">
          列：学号 , 姓名 , 班级 , 联系方式（表头中英文均可，无表头按此顺序）· 学号唯一，重复学号更新资料 ·{' '}
          <button className="linklike" onClick={downloadTemplate}>下载模板</button>
        </span>
      </div>

      {err && <div className="alert error" style={{ marginTop: 10 }}><Icon name="alert" size={14} /> {err}</div>}

      {rows.length > 0 && (
        <div className="import-preview">
          <div className="import-preview-head">
            <strong>预览（前 {Math.min(PREVIEW_ROWS, rows.length)} / {rows.length} 行）</strong>
            <span className="hint">有效 {valid.length} 行{invalidCount > 0 ? ` · ${invalidCount} 行缺学号/姓名将跳过` : ''}</span>
            <button className="btn tiny ghost" onClick={() => { setRows([]); setFilename(''); }}>清除</button>
          </div>
          <table className="grid">
            <thead><tr><th>学号</th><th>姓名</th><th>班级</th><th>联系方式</th><th>校验</th></tr></thead>
            <tbody>
              {rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                <tr key={i} className={r.student_no && r.name ? '' : 'row-muted'}>
                  <td>{r.student_no || '—'}</td>
                  <td>{r.name || '—'}</td>
                  <td>{r.class_name || '—'}</td>
                  <td>{r.contact || '—'}</td>
                  <td>{r.student_no && r.name ? <span className="tag confirmed">有效</span> : <span className="tag failed">缺必填</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="import-opts">
        <label className={`switch ${createAccounts ? 'on' : ''}`}>
          <input type="checkbox" checked={createAccounts} onChange={(e) => setCreateAccounts(e.target.checked)} />
          <span className="track"><span className="knob" /></span>
          <span className="txt">同时按学号批量创建登录账号<small>已有账号者跳过；新账号首次登录强制改密</small></span>
        </label>
        {createAccounts && (
          <label className="import-pwd">
            <span className="k">默认密码</span>
            <input className="mini" type="text" value={defaultPassword} placeholder="≥6 位" onChange={(e) => setDefaultPassword(e.target.value)} />
          </label>
        )}
        <button className="btn primary import-go" disabled={!canImport} onClick={() => void doImport()}>
          {busy ? <span className="spinner" /> : <Icon name="upload" size={15} />}
          <span>{busy ? '导入中…' : `导入 ${valid.length} 名学生${createAccounts ? ' 并建号' : ''}`}</span>
        </button>
      </div>

      {result && (
        <div className="import-result">
          <div className="alert ok">
            <Icon name="checkCircle" size={14} /> 导入完成（批次 #{result.batchId}）：新增学生 {result.createdStudents} · 更新资料 {result.updatedStudents}
            {createAccounts ? ` · 新建账号 ${result.createdAccounts} · 已有账号 ${result.existingAccounts}` : ''}
          </div>
          {result.errors?.length > 0 && (
            <ul className="import-errors">
              {result.errors.map((e, i) => <li key={i}><Icon name="alert" size={12} /> {e}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
