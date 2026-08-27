export function nextTimelineCount(current: number, total: number, batchSize = 8): number {
  if (total <= 0) return 0;
  return Math.min(total, Math.max(0, current) + Math.max(1, batchSize));
}
