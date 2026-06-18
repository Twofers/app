import { useEffect, useState } from "react";

import { SLOW_LOAD_HINT_MS } from "@/constants/timing";

export function useLoadingTimeout(active: boolean, timeoutMs: number = SLOW_LOAD_HINT_MS, resetKey?: unknown) {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!active) {
      setTimedOut(false);
      return;
    }
    setTimedOut(false);
    const id = setTimeout(() => setTimedOut(true), timeoutMs);
    return () => clearTimeout(id);
  }, [active, timeoutMs, resetKey]);

  return timedOut;
}
