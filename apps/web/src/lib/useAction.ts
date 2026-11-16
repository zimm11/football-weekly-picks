import { useCallback, useRef, useState } from "react";
import { messageOf } from "../api";
import { notifyDone, notifyError } from "../notify";

/**
 * Runs a screen's actions one at a time. `busy` names the one under way, so its button can say what it is
 * doing ("Pulling…") while the others are disabled, and the outcome is announced with `notifyDone` or
 * `notifyError`. `run` resolves to whether the action succeeded; one started while another is under way is
 * ignored.
 */
export function useAction<Key extends string = string>() {
  const [busy, setBusy] = useState<Key | null>(null);
  const running = useRef(false);
  const run = useCallback(async (key: Key, task: () => Promise<unknown>, done?: string): Promise<boolean> => {
    if (running.current) return false;
    running.current = true;
    setBusy(key);
    try {
      await task();
      if (done) notifyDone(done);
      return true;
    } catch (err) {
      notifyError(messageOf(err));
      return false;
    } finally {
      running.current = false;
      setBusy(null);
    }
  }, []);
  return { busy, run };
}
