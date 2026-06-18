import { SLOW_LOAD_HINT_MS } from "../constants/timing";

export function hasLoadingTimedOut({
  active,
  startedAtMs,
  nowMs,
  timeoutMs = SLOW_LOAD_HINT_MS,
}: {
  active: boolean;
  startedAtMs: number;
  nowMs: number;
  timeoutMs?: number;
}) {
  return active && nowMs - startedAtMs >= timeoutMs;
}
