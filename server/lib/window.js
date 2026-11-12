// 时间窗判定 (§7)：服务器时钟为准；教务 force_state 应急覆盖优先。
export function effectiveStageStatus(stage, now = Date.now()) {
  if (stage.force_state === 'forced_open') return 'open';
  if (stage.force_state === 'forced_closed') return 'closed';
  const opens = new Date(stage.opens_at).getTime();
  const closes = new Date(stage.closes_at).getTime();
  if (now < opens) return 'pending';
  if (now < closes) return 'open';
  return 'closed';
}

export function currentStage(stages, now = Date.now()) {
  const withStatus = stages.map((s) => ({ ...s, effective: effectiveStageStatus(s, now) }));
  return (
    withStatus.find((s) => s.effective === 'open') ||
    withStatus.find((s) => s.effective === 'pending') ||
    withStatus[withStatus.length - 1] ||
    null
  );
}