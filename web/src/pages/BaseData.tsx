import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Icon } from '../components/icons';
import RosterImport from '../components/RosterImport';
import type { Lab, MentorStat, Student } from '../types';

const STUDENT_STATUS: Record<string, string> = {
  pending_fill: '待填报', filled: '已填志愿', interviewed: '已面试', provisional: '拟录取',
  pending_confirm: '待确认', confirmed: '已确认入组', unadmitted: '未录取', supplementary: '补录中',
  coordination: '统筹调剂', enrolled: '入组', published: '公示中', formal: '正式入组', failed: '落榜',
};

export default function BaseData() {
  const [labs, setLabs] = useState<(Lab & { mentor_count: number; total_quota: number })[]>([]);
  const [mentors, setMentors] = useState<MentorStat[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [error, setError] = useState('');
  const [sq, setSq] = useState('');

  const load = useCallback(() => {
    Promise.all([
      api<{ labs: (Lab & { mentor_count: number; total_quota: number })[] }>('/base/labs'),
      api<{ mentors: MentorStat[] }>('/base/mentors'),
      api<{ students: Student[] }>('/base/students'),
    ]).then(([l, m, s]) => { setLabs(l.labs); setMentors(m.mentors); setStudents(s.students); setError(''); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="alert error">{error}</div>;

  const kw = sq.trim().toLowerCase();
  const shownStudents = kw
    ? students.filter((s) => [s.student_no, s.name, s.class_name].filter(Boolean).join(' ').toLowerCase().includes(kw))
    : students;

  return (
    <div className="page">
      <div className="page-head"><h2>底表与名额</h2><span className="hint">教务名册 CSV 批量导入 · 学号绑定预置账号 · 实训室名额 = 本室各导师之和</span></div>

      <section className="panel lift">
        <h3><Icon name="upload" size={14} /> 学生名册导入（CSV / Excel→CSV · 可批量建号）</h3>
        <p className="hint">系统按上传的名册登记学生（学号唯一）；勾选「批量建号」后按学号自动创建登录账号，首次登录强制改密。导入后学生即出现在下方名册与「审计与回填 · 学生账号」面板。</p>
        <RosterImport onImported={load} />
      </section>

      <section className="panel">
        <h3>实训室（名额 = 本室各导师之和）</h3>
        <table className="grid">
          <thead><tr><th>编号</th><th>名称</th><th>导师数</th><th>总名额</th><th>简介</th></tr></thead>
          <tbody>{labs.map((l) => <tr key={l.id}><td>{l.code}</td><td>{l.name}</td><td>{l.mentor_count}</td><td>{l.total_quota}</td><td>{l.description}</td></tr>)}</tbody>
        </table>
      </section>

      <section className="panel">
        <h3>导师与硬名额</h3>
        <table className="grid">
          <thead><tr><th>工号</th><th>姓名</th><th>实训室</th><th>职称</th><th>硬名额</th></tr></thead>
          <tbody>{mentors.map((m) => <tr key={m.id}><td>{m.code}</td><td>{m.name}</td><td>{m.lab_name}</td><td>{m.title}</td><td>{m.quota}</td></tr>)}</tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>学生名册（{shownStudents.length}/{students.length}）</h3>
          <div className="panel-tools">
            <input className="mini search" type="search" value={sq} placeholder="搜索学号 / 姓名 / 班级" onChange={(e) => setSq(e.target.value)} />
          </div>
        </div>
        <table className="grid">
          <thead><tr><th>学号</th><th>姓名</th><th>班级</th><th>状态</th></tr></thead>
          <tbody>{shownStudents.map((s) => <tr key={s.id}><td>{s.student_no}</td><td>{s.name}</td><td>{s.class_name}</td><td>{STUDENT_STATUS[s.status] || s.status}</td></tr>)}</tbody>
        </table>
        {shownStudents.length === 0 && <p className="empty">{kw ? '没有匹配的学生。' : '暂无学生，请上传名册。'}</p>}
      </section>
    </div>
  );
}
