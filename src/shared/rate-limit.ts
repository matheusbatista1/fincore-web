/**
 * A fixed-window counter: at most `limit` passes per `windowMs`, the rest refused until the
 * window turns. Kept in memory, so it bounds one server instance — enough to stop a flood from
 * filling a log, not a guarantee across instances.
 *
 * @returns `allow(now)`: whether one more may pass at `now` (epoch milliseconds).
 */
export function createRateLimiter(limit: number, windowMs: number): (now: number) => boolean {
  let windowStart = Number.NEGATIVE_INFINITY;
  let passed = 0;
  return (now) => {
    if (now - windowStart >= windowMs) {
      windowStart = now;
      passed = 0;
    }
    if (passed >= limit) return false;
    passed += 1;
    return true;
  };
}
