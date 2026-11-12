import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, tx } from './connection.js';
import { hashPassword } from '../lib/security.js';

const here = dirname(fileURLToPath(import.meta.url));
// schema 全部 IF NOT EXISTS，幂等；db:seed 可独立运行。
db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));

const DEMO_PASSWORD = '123456';
const pwd = hashPassword(DEMO_PASSWORD);
const hour = 3600 * 1000;
const base = Date.now();
const iso = (ms) => new Date(ms).toISOString();

// 演示时间窗：让"意向填报"此刻处于开放态，dashboard 可见活动窗口。
const stageDefs = [
  [3, 'fill', '意向填报', base - hour, base + 3 * hour],
  [4, 'interview', '导师初选/面试', base + 3 * hour, base + 27 * hour],
  [5, 'confirm', '拟录取确认', base + 27 * hour, base + 31 * hour],
  [6, 'supplementary', '分轮补录', base + 31 * hour, base + 55 * hour],
  [7, 'coordination', '全院统筹调剂', base + 55 * hour, base + 59 * hour],
  [8, 'publication', '公示入组', base + 59 * hour, base + 83 * hour],
];
const stageStatus = (opens, closes) => {
  const now = Date.now();
  if (now < opens) return 'pending';
  if (now < closes) return 'open';
  return 'closed';
};

tx(() => {
  // 实训室
  db.prepare('INSERT OR IGNORE INTO labs(code,name,description) VALUES(?,?,?)').run('LAB-A', '智能软件实训室', '软件工程 / 人工智能方向');
  db.prepare('INSERT OR IGNORE INTO labs(code,name,description) VALUES(?,?,?)').run('LAB-B', '网络与数据实训室', '网络工程 / 大数据方向');
  const labA = db.prepare('SELECT id FROM labs WHERE code=?').get('LAB-A').id;
  const labB = db.prepare('SELECT id FROM labs WHERE code=?').get('LAB-B').id;

  // 导师 + 导师级硬名额 (教务直分)
  const mentors = [
    ['M001', '张明', labA, '副教授', 3],
    ['M002', '李华', labA, '讲师', 2],
    ['M003', '王芳', labB, '教授', 3],
    ['M004', '赵强', labB, '副教授', 2],
  ];
  for (const [code, name, lab_id, title, quota] of mentors) {
    db.prepare('INSERT OR IGNORE INTO mentors(code,name,lab_id,title) VALUES(?,?,?,?)').run(code, name, lab_id, title);
    const mid = db.prepare('SELECT id FROM mentors WHERE code=?').get(code).id;
    db.prepare('INSERT OR IGNORE INTO mentor_quotas(mentor_id,quota) VALUES(?,?)').run(mid, quota);
  }

  // 学生 (8 人 ≤ 总名额 10，满足"全员名额 ≥ 学生总数")
  const students = [
    ['2024001', '陈晨', '软件2401'], ['2024002', '刘洋', '软件2401'],
    ['2024003', '杨帆', '软件2402'], ['2024004', '周婷', '软件2402'],
    ['2024005', '吴磊', '网络2401'], ['2024006', '郑爽', '网络2401'],
    ['2024007', '孙浩', '数据2401'], ['2024008', '马丽', '数据2401'],
  ];
  for (const [no, name, cls] of students) {
    db.prepare('INSERT OR IGNORE INTO students(student_no,name,class_name) VALUES(?,?,?)').run(no, name, cls);
  }
  const stu1 = db.prepare('SELECT id FROM students WHERE student_no=?').get('2024001').id;
  const stu2 = db.prepare('SELECT id FROM students WHERE student_no=?').get('2024002').id;
  const stu3 = db.prepare('SELECT id FROM students WHERE student_no=?').get('2024003').id;
  const stu5 = db.prepare('SELECT id FROM students WHERE student_no=?').get('2024005').id;
  const mentor1 = db.prepare('SELECT id FROM mentors WHERE code=?').get('M001').id;
  const mentor2 = db.prepare('SELECT id FROM mentors WHERE code=?').get('M002').id;
  const mentor3 = db.prepare('SELECT id FROM mentors WHERE code=?').get('M003').id;

  // 4 层角色演示账号 (学号/工号绑定，首次登录强制改密)
  const accounts = [
    ['admin', 'academic_affairs', '教务管理员', null, null, null],
    ['M001', 'mentor', '张明', null, mentor1, null],
    ['M002', 'mentor', '李华', null, mentor2, null],
    ['M003', 'mentor', '王芳', null, mentor3, null],
    ['H001', 'lab_head', '实训室A负责人', null, null, labA],
    ['H002', 'lab_head', '实训室B负责人', null, null, labB],
    ['2024001', 'student', '陈晨', stu1, null, null],
    ['2024002', 'student', '刘洋', stu2, null, null],
    ['2024003', 'student', '杨帆', stu3, null, null],
    ['2024005', 'student', '吴磊', stu5, null, null],
  ];
  for (const [username, role, display_name, student_id, mentor_id, lab_id] of accounts) {
    db.prepare(
      `INSERT OR IGNORE INTO users(username,password_hash,role,display_name,student_id,mentor_id,lab_id,must_change_password)
       VALUES(?,?,?,?,?,?,?,1)`
    ).run(username, pwd, role, display_name, student_id, mentor_id, lab_id);
  }

  // 选拔轮次 (轮次为中心)
  db.prepare("INSERT OR IGNORE INTO rounds(round_no,type,name,status) VALUES(1,'initial','第一轮 初选+确认','open')").run();
  db.prepare("INSERT OR IGNORE INTO rounds(round_no,type,name,status) VALUES(2,'supplementary','第二轮 补录','pending')").run();

  // 阶段时间窗
  for (const [no, code, name, opens, closes] of stageDefs) {
    db.prepare(
      `INSERT OR IGNORE INTO stages(stage_no,code,name,opens_at,closes_at,status)
       VALUES(?,?,?,?,?,?)`
    ).run(no, code, name, iso(opens), iso(closes), stageStatus(opens, closes));
  }

  // 欢迎站内提示 (幂等)
  db.prepare(
    `INSERT INTO notices(role_target,title,body,level)
     SELECT 'academic_affairs','系统骨架已就绪','数据库与前后端骨架已搭建，底表/账号/时间窗已导入演示数据。','info'
     WHERE NOT EXISTS (SELECT 1 FROM notices WHERE title='系统骨架已就绪')`
  ).run();
});

const counts = {
  labs: db.prepare('SELECT COUNT(*) c FROM labs').get().c,
  mentors: db.prepare('SELECT COUNT(*) c FROM mentors').get().c,
  students: db.prepare('SELECT COUNT(*) c FROM students').get().c,
  users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
  totalQuota: db.prepare('SELECT COALESCE(SUM(quota),0) q FROM mentor_quotas').get().q,
};
console.log('[db:seed] done:', JSON.stringify(counts));
console.log('[db:seed] 演示账号 (初始密码均为 123456，首次登录强制改密):');
console.log('  教务 admin | 导师 M001/M002/M003 | 负责人 H001/H002 | 学生 2024001/2024002/2024003/2024005');
db.close();