import { db } from '../db/connection.js';

// 全程审计 (§6)：每次提交/递补/调剂/回填/解锁/强制推进/开合窗留痕。
export function logAudit({
  actorUserId = null,
  actorRole = null,
  action,
  entityType = null,
  entityId = null,
  studentId = null,
  roundId = null,
  detail = null,
}) {
  db.prepare(
    `INSERT INTO audit_logs(actor_user_id,actor_role,action,entity_type,entity_id,student_id,round_id,detail)
     VALUES(?,?,?,?,?,?,?,?)`
  ).run(
    actorUserId,
    actorRole,
    action,
    entityType,
    entityId,
    studentId,
    roundId,
    detail ? JSON.stringify(detail) : null
  );
}