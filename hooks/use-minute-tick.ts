import { useEffect, useState } from "react";

/** Bumps every 60s so countdown / expiry labels stay fresh without per-second churn. */
export function useMinuteTick(): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return t;
}
