-- 学生实训室进组选拔填报系统 — 数据库 schema (spec v1.1)
-- 引擎: SQLite (node:sqlite) · 模型: 选拔轮次为中心 · 硬名额挂导师级
-- 所有时间戳以服务器 UTC 为准 (strftime 'now')，时间窗开合由服务器时钟判定。

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────
-- 基础底表 (教务 Excel 批量导入) — §7 §8
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS labs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,                 -- 实训室编号
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS mentors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,                 -- 工号
  name        TEXT NOT NULL,
  lab_id      INTEGER NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  title       TEXT,
  intro       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 导师级硬名额 (教务直分制 Model B)。实训室名额 = 本室各导师 quota 之和 (派生，不存储)。
CREATE TABLE IF NOT EXISTS mentor_quotas (
  mentor_id  INTEGER PRIMARY KEY REFERENCES mentors(id) ON DELETE CASCADE,
  quota      INTEGER NOT NULL CHECK (quota >= 0),
  set_by     INTEGER,                              -- users.id (教务)
  set_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS students (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_no  TEXT NOT NULL UNIQUE,                 -- 学号 (账号绑定)
  name        TEXT NOT NULL,
  class_name  TEXT,
  contact     TEXT,
  -- 学生状态机 (§3)。终态仅 formal / failed，无悬空态。
  status      TEXT NOT NULL DEFAULT 'pending_fill' CHECK (status IN (
                'pending_fill','filled','interviewed','provisional','pending_confirm',
                'confirmed','unadmitted','supplementary','coordination','enrolled',
                'published','formal','failed')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ─────────────────────────────────────────────────────────────
-- 账号 / 会话 — 4 层角色，学号绑定，首次登录强制改密 (§7)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  username             TEXT NOT NULL UNIQUE,        -- 学生=学号 / 职工=工号
  password_hash        TEXT NOT NULL,               -- scrypt: salt:hash
  role                 TEXT NOT NULL CHECK (role IN ('student','mentor','lab_head','academic_affairs')),
  display_name         TEXT NOT NULL,
  student_id           INTEGER REFERENCES students(id) ON DELETE CASCADE,
  mentor_id            INTEGER REFERENCES mentors(id) ON DELETE CASCADE,
  lab_id               INTEGER REFERENCES labs(id) ON DELETE CASCADE,  -- lab_head 管辖本室
  must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0,1)),
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at        TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,                  -- sha256(token)，明文不落库
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ─────────────────────────────────────────────────────────────
-- 选拔轮次 / 时间窗 — 模型以轮次为中心 (§2)；系统从第 3 步起管 (§4)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rounds (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  round_no   INTEGER NOT NULL,                      -- 1=初选+确认, 2/3=补录
  type       TEXT NOT NULL CHECK (type IN ('initial','supplementary')),
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','open','closed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (round_no)
);

-- 阶段时间窗 (第 3–8 步)。定时任务按服务器时钟开合；教务应急 force_state 覆盖。
CREATE TABLE IF NOT EXISTS stages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_no    INTEGER NOT NULL UNIQUE CHECK (stage_no BETWEEN 3 AND 8),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  opens_at    TEXT NOT NULL,
  closes_at   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','open','closed')),
  force_state TEXT CHECK (force_state IN ('forced_open','forced_closed')),  -- NULL=按时间自动
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (closes_at > opens_at)
);

-- ─────────────────────────────────────────────────────────────
-- 意向填报 (§5.1) — ≤3 平行导师志愿 (不分先后) + 两个独立服从勾选；提交即定不可改
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS applications (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id                 INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  student_id               INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  accept_internal_transfer INTEGER NOT NULL DEFAULT 0 CHECK (accept_internal_transfer IN (0,1)),  -- 服从内部(同室换导师)
  accept_cross_lab_transfer INTEGER NOT NULL DEFAULT 0 CHECK (accept_cross_lab_transfer IN (0,1)), -- 服从跨室 (独立生效)
  status                   TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','returned')),
  submitted_at             TEXT,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (round_id, student_id)                     -- 每生每轮一份志愿
);

-- 平行志愿明细：无排序列 (不分先后)；≤3 由应用层 + 触发器强制。
CREATE TABLE IF NOT EXISTS application_choices (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  mentor_id      INTEGER NOT NULL REFERENCES mentors(id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (application_id, mentor_id)
);

CREATE TRIGGER IF NOT EXISTS trg_choices_max3
BEFORE INSERT ON application_choices
WHEN (SELECT COUNT(*) FROM application_choices WHERE application_id = NEW.application_id) >= 3
BEGIN
  SELECT RAISE(ABORT, '最多 3 个平行导师志愿');
END;

-- 填报附件 — 学生随志愿上传证明材料；提交前可增删，提交后随志愿锁定仅可下载。
CREATE TABLE IF NOT EXISTS application_attachments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,  -- 提交前为 NULL，提交时回填
  student_id     INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  round_id       INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  filename       TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL CHECK (size_bytes > 0),
  content        BLOB NOT NULL,
  uploaded_by    INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_attachments_owner ON application_attachments (student_id, round_id);

-- ─────────────────────────────────────────────────────────────
-- 面试成绩 (§4 步4) — 全员必面；补录(步6)沿用，不重面试
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS interview_scores (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id      INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  mentor_id       INTEGER NOT NULL REFERENCES mentors(id) ON DELETE CASCADE,
  source_round_id INTEGER REFERENCES rounds(id),    -- 成绩产生轮次 (通常 round 1)
  score           REAL NOT NULL CHECK (score >= 0),
  note            TEXT,
  scored_by       INTEGER REFERENCES users(id),
  scored_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (student_id, mentor_id)                    -- 一导师对一生一次成绩，跨轮复用
);

-- ─────────────────────────────────────────────────────────────
-- 导师候选名单 (§4 步4) — 拟录取 / 递补(预排序) / 内部调剂候选；提交即定
-- 拟录取数 ≤ 导师硬名额 (应用层在提交时校验)；导师定"人"，名额定"量"。
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS candidate_lists (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id      INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  mentor_id     INTEGER NOT NULL REFERENCES mentors(id) ON DELETE CASCADE,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  category      TEXT NOT NULL CHECK (category IN ('admit','waitlist','internal_transfer')),
  waitlist_rank INTEGER,                            -- 仅 waitlist：导师预排顺延顺序
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','promoted','confirmed','rejected','expired','skipped')),
  decided_by    INTEGER REFERENCES users(id),
  decided_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  submitted_at  TEXT,                               -- 名单提交锁定时间
  UNIQUE (round_id, mentor_id, student_id),
  CHECK (category <> 'waitlist' OR waitlist_rank IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_candidate_waitlist
  ON candidate_lists (round_id, mentor_id, category, waitlist_rank);

-- ─────────────────────────────────────────────────────────────
-- 去向 / 确认记录 (§5.3-5.7) — 确认即锁定不可逆；多录取选唯一去向
-- source 区分: 拟录取确认 / 递补顺延 / 补录 / 内部调剂 / 跨室调剂 / 统筹 / 教务回填
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS placements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  round_id     INTEGER REFERENCES rounds(id),
  mentor_id    INTEGER REFERENCES mentors(id),
  lab_id       INTEGER REFERENCES labs(id),         -- 派生自 mentor，回填时可直接指定
  source       TEXT NOT NULL CHECK (source IN (
                 'admit_confirm','waitlist_promote','supplementary',
                 'internal_transfer','cross_lab_transfer','coordination','manual_backfill')),
  candidate_id INTEGER REFERENCES candidate_lists(id),  -- 来源候选行 (递补/拟录取)
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','declined','expired','removed')),
  confirmed_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 铁律：一个学生最多一条"已确认锁定"去向 (确认瞬间并发锁 + 此唯一索引双保险)。
CREATE UNIQUE INDEX IF NOT EXISTS uq_placement_one_confirmed
  ON placements (student_id) WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS idx_placement_mentor_status ON placements (mentor_id, status);
CREATE INDEX IF NOT EXISTS idx_placement_student ON placements (student_id);

-- ─────────────────────────────────────────────────────────────
-- 公示 / 异议 (§5.8 §6) — 满1天无异议自动生效；只晒姓名+实训室/导师；仅本人申诉
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS publications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  placement_id INTEGER NOT NULL REFERENCES placements(id) ON DELETE CASCADE,
  mentor_id    INTEGER REFERENCES mentors(id),
  lab_id       INTEGER REFERENCES labs(id),
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  effective_at TEXT NOT NULL,                       -- published_at + 1 天
  status       TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','effective','appealed','removed')),
  UNIQUE (placement_id)
);

CREATE TABLE IF NOT EXISTS appeals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_id  INTEGER NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  student_id      INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,  -- 必须本人
  reason          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','upheld','rejected')),
  handled_by      INTEGER REFERENCES users(id),
  handled_at      TEXT,
  resolution_note TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ─────────────────────────────────────────────────────────────
-- 审计日志 (§6 全程审计) — 提交/递补/调剂/回填/解锁/强制推进/开合窗 全留痕
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id),
  actor_role   TEXT,
  action       TEXT NOT NULL,                       -- submit_application / confirm / promote_waitlist / ...
  entity_type  TEXT,
  entity_id    INTEGER,
  student_id   INTEGER REFERENCES students(id),
  round_id     INTEGER REFERENCES rounds(id),
  detail       TEXT,                                -- JSON 快照
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_action_time ON audit_logs (action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_student ON audit_logs (student_id);

-- ─────────────────────────────────────────────────────────────
-- 站内提示 (MVP 基础通知，短信后置) — 待确认/异常叫人/时间窗提醒
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- NULL=广播
  role_target TEXT,                               -- NULL=全体；否则按角色广播
  title      TEXT NOT NULL,
  body       TEXT,
  level      TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warn','action')),
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ─────────────────────────────────────────────────────────────
-- Excel 导入批次 (§7) — 底表/账号/名额 批量导入留痕
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS import_batches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK (kind IN ('students','mentors','labs','quotas','accounts','mixed')),
  filename    TEXT,
  row_count   INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed')),
  imported_by INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);