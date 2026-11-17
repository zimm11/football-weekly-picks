import { useEffect, useState } from "react";
import { messageOf, request } from "./api";
import { useRemovalGuard, useUnsavedWork } from "./unsaved";
export function useResource<T>(path: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries the request.
  useEffect(() => {
    let active = true;
    setData(undefined);
    setError(undefined);
    request<T>(path).then(
      (value) => {
        if (active) setData(value);
      },
      (err) => {
        if (active) setError(messageOf(err));
      },
    );
    return () => {
      active = false;
    };
  }, [path, attempt]);
  return { data, setData, error, reload: () => setAttempt((n) => n + 1) };
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  return {
    busy,
    error,
    status,
    run: async (action: () => Promise<void>, success?: string) => {
      if (busy) return;
      setBusy(true);
      setError(undefined);
      setStatus(undefined);
      try {
        await action();
        setStatus(success);
      } catch (err) {
        setError(messageOf(err));
      } finally {
        setBusy(false);
      }
    },
  };
}
export function useFormGuard(dirty: boolean, onDiscard?: () => void) {
  useUnsavedWork(dirty, onDiscard);
  useRemovalGuard(dirty);
}
