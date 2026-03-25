import { useEffect, useState } from "react";

/** Re-renders every second for live countdowns (wallet, verification UI). */
export function useSecondTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
