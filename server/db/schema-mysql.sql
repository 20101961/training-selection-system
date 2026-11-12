-- 学生实训室进组选拔填报系统 — MySQL 版建表脚本 (由 SQLite schema 转换)
-- 目标: MySQL 5.7 / 8.0 · InnoDB · utf8mb4
-- 迁移说明:
--   1) SQLite 的"部分唯一索引"(每生仅一条 status='confirmed' 去向)无法在 MySQL 表达 -> 改由应用层保证。
--   2) SQLite 的"最多 3 平行志愿"触发器在 MySQL BEFORE INSERT 里不能查同表 -> 改由应用层保证。
--   3) 时间戳由 ISO 文本转 DATETIME(3); 布尔 0/1 转 TINYINT(1); 枚举列转 ENUM。
--   4) 附件正文是 LONGBLOB，数据脚本以 0x 十六进制写入；导入前先 SET GLOBAL max_allowed_packet=67108864;
--      (本系统单附件上限 5MB，一条 INSERT 约 10MB 文本。)
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS `lab_selection` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `lab_selection`;

-- ─────────────────────────────────────────────────────────────
-- ① 基础底表 (教务 Excel 批量导入) — §7 §8
-- ─────────────────────────────────────────────────────────────

-- 实训室
CREATE TABLE IF NOT EXISTS `labs` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `code`       VARCHAR(64) NOT NULL,
  `name`       VARCHAR(128) NOT NULL,
  `description` TEXT,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_labs_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 导师
CREATE TABLE IF NOT EXISTS `mentors` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `code`       VARCHAR(64) NOT NULL,
  `name`       VARCHAR(128) NOT NULL,
  `lab_id`     INT NOT NULL,
  `title`      VARCHAR(64),
  `intro`      TEXT,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mentors_code` (`code`),
  KEY `idx_mentors_lab` (`lab_id`),
  CONSTRAINT `fk_mentors_lab` FOREIGN KEY (`lab_id`) REFERENCES `labs`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 导师级硬名额 (教务直分)
CREATE TABLE IF NOT EXISTS `mentor_quotas` (
  `mentor_id` INT NOT NULL,
  `quota`     INT NOT NULL,
  `set_by`    INT,
  `set_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`mentor_id`),
  CONSTRAINT `fk_mq_mentor` FOREIGN KEY (`mentor_id`) REFERENCES `mentors`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 学生 (含状态机)
CREATE TABLE IF NOT EXISTS `students` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `student_no` VARCHAR(32) NOT NULL,
  `name`       VARCHAR(128) NOT NULL,
  `class_name` VARCHAR(64),
  `contact`    VARCHAR(128),
  `status`     ENUM('pending_fill','filled','interviewed','provisional','pending_confirm','confirmed','unadmitted','supplementary','coordination','enrolled','published','formal','failed') NOT NULL DEFAULT 'pending_fill',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_students_no` (`student_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- ② 账号 / 会话 — 4 层角色，学号绑定，首次登录强制改密 (§7)
-- ─────────────────────────────────────────────────────────────

-- 账号 (4 角色 · 学号绑定 · 首次强制改密)
CREATE TABLE IF NOT EXISTS `users` (
  `id`                   INT NOT NULL AUTO_INCREMENT,
  `username`             VARCHAR(64) NOT NULL,
  `password_hash`        VARCHAR(255) NOT NULL,
  `role`                 ENUM('student','mentor','lab_head','academic_affairs') NOT NULL,
  `display_name`         VARCHAR(128) NOT NULL,
  `student_id`           INT,
  `mentor_id`            INT,
  `lab_id`               INT,
  `must_change_password` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_login_at`        DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`),
  KEY `idx_users_student` (`student_id`),
  KEY `idx_users_mentor` (`mentor_id`),
  KEY `idx_users_lab` (`lab_id`),
  CONSTRAINT `fk_users_student` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_users_mentor` FOREIGN KEY (`mentor_id`) REFERENCES `mentors`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_users_lab` FOREIGN KEY (`lab_id`) REFERENCES `labs`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 会话
CREATE TABLE IF NOT EXISTS `sessions` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `user_id`    INT NOT NULL,
  `token_hash` VARCHAR(64) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sessions_token` (`token_hash`),
  KEY `idx_sessions_user` (`user_id`),
  CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- ③ 选拔轮次 / 时间窗 — 以轮次为中心 (§2)，系统从第 3 步起管 (§4)
-- ─────────────────────────────────────────────────────────────

-- 选拔轮次
CREATE TABLE IF NOT EXISTS `rounds` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `round_no`   INT NOT NULL,
  `type`       ENUM('initial','supplementary') NOT NULL,
  `name`       VARCHAR(128) NOT NULL,
  `status`     ENUM('pending','open','closed') NOT NULL DEFAULT 'pending',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rounds_no` (`round_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 阶段时间窗 (第 3–8 步)
CREATE TABLE IF NOT EXISTS `stages` (
  `id`          INT NOT NULL AUTO_INCREMENT,
  `stage_no`    INT NOT NULL,
  `code`        VARCHAR(64) NOT NULL,
  `name`        VARCHAR(128) NOT NULL,
  `opens_at`    DATETIME(3) NOT NULL,
  `closes_at`   DATETIME(3) NOT NULL,
  `status`      ENUM('pending','open','closed') NOT NULL DEFAULT 'pending',
  `force_state` ENUM('forced_open','forced_closed') NULL,
  `updated_by`  INT NULL,
  `updated_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stages_no` (`stage_no`),
  UNIQUE KEY `uq_stages_code` (`code`),
  KEY `idx_stages_updated_by` (`updated_by`),
  CONSTRAINT `chk_stage_window` CHECK (`closes_at` > `opens_at`),
  CONSTRAINT `fk_stages_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- ④ 意向填报 (§5.1) — ≤3 平行导师志愿 (不分先后) + 两个独立服从勾选；提交即定不可改
-- ─────────────────────────────────────────────────────────────

-- 志愿 (提交即定 · 两个独立服从勾选)
CREATE TABLE IF NOT EXISTS `applications` (
  `id`                       INT NOT NULL AUTO_INCREMENT,
  `round_id`                 INT NOT NULL,
  `student_id`               INT NOT NULL,
  `accept_internal_transfer` TINYINT(1) NOT NULL DEFAULT 0,
  `accept_cross_lab_transfer` TINYINT(1) NOT NULL DEFAULT 0,
  `status`                   ENUM('draft','submitted','returned') NOT NULL DEFAULT 'draft',
  `submitted_at`             DATETIME(3) NULL,
  `created_at`               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_app_round_student` (`round_id`,`student_id`),
  KEY `idx_app_student` (`student_id`),
  CONSTRAINT `fk_app_round` FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_app_student` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 平行志愿明细 (不分先后 · ≤3 由应用层保证)
CREATE TABLE IF NOT EXISTS `application_choices` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `application_id` INT NOT NULL,
  `mentor_id`      INT NOT NULL,
  `created_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_choice_app_mentor` (`application_id`,`mentor_id`),
  KEY `idx_choice_mentor` (`mentor_id`),
  CONSTRAINT `fk_choice_app` FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_choice_mentor` FOREIGN KEY (`mentor_id`) REFERENCES `mentors`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- ⑤ 面试与候选名单 (§4 步4) — 全员必面；导师定"人"，名额定"量"
-- ─────────────────────────────────────────────────────────────

-- 面试成绩 (补录沿用)
CREATE TABLE IF NOT EXISTS `interview_scores` (
  `id`              INT NOT NULL AUTO_INCREMENT,
  `student_id`      INT NOT NULL,
  `mentor_id`       INT NOT NULL,
  `source_round_id` INT NULL,
  `score`           DOUBLE NOT NULL,
  `note`            TEXT,
  `scored_by`       INT NULL,
  `scored_at`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_score_student_mentor` (`student_id`,`mentor_id`),
  KEY `idx_score_mentor` (`mentor_id`),
  KEY `idx_score_round` (`source_round_id`),
  CONSTRAINT `fk_score_student` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_score_mentor` FOREIGN KEY (`mentor_id`) REFERENCES `mentors`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_score_round` FOREIGN KEY (`source_round_id`) REFERENCES `rounds`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 导师候选名单 (拟录取/递补/内部调剂 · 提交即锁定)
CREATE TABLE IF NOT EXISTS `candidate_lists` (
  `id`            INT NOT NULL AUTO_INCREMENT,
  `round_id`      INT NOT NULL,
  `mentor_id`     INT NOT NULL,
  `student_id`    INT NOT NULL,
  `category`      ENUM('admit','waitlist','internal_transfer') NOT NULL,
  `waitlist_rank` INT NULL,
  `status`        ENUM('active','promoted','confirmed','rejected','expired','skipped') NOT NULL DEFAULT 'active',
  `decided_by`    INT NULL,
  `decided_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `submitted_at`  DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cl_round_mentor_student` (`round_id`,`mentor_id`,`student_id`),
  KEY `idx_candidate_waitlist` (`round_id`,`mentor_id`,`category`,`waitlist_rank`),
  CONSTRAINT `fk_cl_round` FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cl_mentor` FOREIGN KEY (`mentor_id`) REFERENCES `mentors`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cl_student` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cl_decided_by` FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- ⑥ 去向 / 确认记录 (§5.3-5.7) — 确认即锁定不可逆；多录取选唯一去向
-- ─────────────────────────────────────────────────────────────

-- 去向/确认记录 (确认即锁定 · 唯一性由应用层保证)
CREATE TABLE IF NOT EXISTS `placements` (
  `id`           INT NOT NULL AUTO_INCREMENT,
  `student_id`   INT NOT NULL,
  `round_id`     INT NULL,
  `mentor_id`    INT NULL,
  `lab_id`       INT NULL,
  `source`       ENUM('admit_confirm','waitlist_promote','supplementary','internal_transfer','cross_lab_transfer','coordination','manual_backfill') NOT NULL,
  `candidate_id` INT NULL,
  `status`       ENUM('pending','confirmed','declined','expired','removed') NOT NULL DEFAULT 'pending',
  `confirmed_at` DATETIME(3) NULL,
  `created_at`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_placement_mentor_status` (`mentor_id`,`status`),
  KEY `idx_placement_student` (`student_id`),
  CONSTRAINT `fk_pl_student` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pl_round` FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`),
  CONSTRAINT `fk_pl_mentor` FOREIGN KEY (`mentor_id`) REFERENCES `mentors`(`id`),
  CONSTRAINT `fk_pl_lab` FOREIGN KEY (`lab_id`) REFERENCES `labs`(`id`),
  CONSTRAINT `fk_pl_candidate` FOREIGN KEY (`candidate_id`) REFERENCES `candidate_lists`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- ⑦ 公示 / 异议 (§5.8 §6) — 满 1 天无异议自动生效；只晒姓名+实训室/导师；仅本人申诉
-- ─────────────────────────────────────────────────────────────

-- 公示 (只晒姓名+实训室/导师)
CREATE TABLE IF NOT EXISTS `publications` (
  `id`           INT NOT NULL AUTO_INCREMENT,
  `student_id`   INT NOT NULL,
  `placement_id` INT NOT NULL,
  `mentor_id`    INT NULL,
  `lab_id`       INT NULL,
  `published_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `effective_at` DATETIME(3) NOT NULL,
  `status`       ENUM('published','effective','appealed','removed') NOT NULL DEFAULT 'published',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pub_placement` (`placement_id`),
  KEY `idx_pub_student` (`student_id`),
  CONSTRAINT `fk_pub_student` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pub_placement` FOREIGN KEY (`placement_id`) REFERENCES `placements`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pub_mentor` FOREIGN KEY (`mentor_id`) REFERENCES `mentors`(`id`),
  CONSTRAINT `fk_pub_lab` FOREIGN KEY (`lab_id`) REFERENCES `labs`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 异议/申诉 (仅本人)
CREATE TABLE IF NOT EXISTS `appeals` (
  `id`              INT NOT NULL AUTO_INCREMENT,
  `publication_id`  INT NOT NULL,
  `student_id`      INT NOT NULL,
  `reason`          TEXT NOT NULL,
  `status`          ENUM('pending','upheld','rejected') NOT NULL DEFAULT 'pending',
  `handled_by`      INT NULL,
  `handled_at`      DATETIME(3) NULL,
  `resolution_note` TEXT,
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_appeal_pub` (`publication_id`),
  KEY `idx_appeal_student` (`student_id`),
  CONSTRAINT `fk_appeal_pub` FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_appeal_student` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_appeal_handled` FOREIGN KEY (`handled_by`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- ⑧ 审计与通知 (§6 全程审计) — 提交/递补/调剂/回填/解锁/强制推进/开合窗 全留痕
-- ─────────────────────────────────────────────────────────────

-- 审计日志 (全程留痕)
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id`            INT NOT NULL AUTO_INCREMENT,
  `actor_user_id` INT NULL,
  `actor_role`    VARCHAR(32) NULL,
  `action`        VARCHAR(64) NOT NULL,
  `entity_type`   VARCHAR(64) NULL,
  `entity_id`     INT NULL,
  `student_id`    INT NULL,
  `round_id`      INT NULL,
  `detail`        TEXT,
  `created_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_audit_action_time` (`action`,`created_at`),
  KEY `idx_audit_student` (`student_id`),
  CONSTRAINT `fk_audit_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`),
  CONSTRAINT `fk_audit_student` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`),
  CONSTRAINT `fk_audit_round` FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 站内提示 (MVP 基础通知)
CREATE TABLE IF NOT EXISTS `notices` (
  `id`          INT NOT NULL AUTO_INCREMENT,
  `user_id`     INT NULL,
  `role_target` VARCHAR(32) NULL,
  `title`       VARCHAR(255) NOT NULL,
  `body`        TEXT,
  `level`       ENUM('info','warn','action') NOT NULL DEFAULT 'info',
  `read_at`     DATETIME(3) NULL,
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_notice_user` (`user_id`),
  CONSTRAINT `fk_notice_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- ⑨ 导入批次与填报附件 (§7 §5.1) — 名册导入留痕；证明材料随志愿上传，提交后锁定
-- ─────────────────────────────────────────────────────────────

-- Excel 导入批次
CREATE TABLE IF NOT EXISTS `import_batches` (
  `id`          INT NOT NULL AUTO_INCREMENT,
  `kind`        ENUM('students','mentors','labs','quotas','accounts','mixed') NOT NULL,
  `filename`    VARCHAR(255) NULL,
  `row_count`   INT NOT NULL DEFAULT 0,
  `status`      ENUM('pending','done','failed') NOT NULL DEFAULT 'pending',
  `imported_by` INT NULL,
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_import_by` (`imported_by`),
  CONSTRAINT `fk_import_by` FOREIGN KEY (`imported_by`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 填报附件 (证明材料随志愿上传，提交后锁定)
CREATE TABLE IF NOT EXISTS `application_attachments` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `application_id` INT NULL,
  `student_id`     INT NOT NULL,
  `round_id`       INT NOT NULL,
  `filename`       VARCHAR(255) NOT NULL,
  `mime_type`      VARCHAR(128) NOT NULL,
  `size_bytes`     INT NOT NULL,
  `content`        LONGBLOB NOT NULL,
  `uploaded_by`    INT NULL,
  `created_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_attachments_owner` (`student_id`,`round_id`),
  CONSTRAINT `fk_attach_app` FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_attach_student` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_attach_round` FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_attach_by` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;