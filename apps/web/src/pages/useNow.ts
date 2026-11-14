import { useEffect, useState } from "react";
import { now as clockNow, clockOffset, onClockChange } from "../clock";

/** Keep clock-derived labels and pick locks fresh while a screen remains open. */
export function useNow(): Date {
  const [now, setNow] = useState(clockNow);
  useEffect(() => {
    const tick = () => setNow(clockNow());
    const timer = setInterval(tick, 30_000);
    const unsubscribe = onClockChange(tick);
    // A local clock override may have arrived between the first render and this effect.
    if (clockOffset() !== 0) tick();
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, []);
  return now;
}
