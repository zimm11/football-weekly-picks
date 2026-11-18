import { useCallback, useEffect, useState } from "react";
import { messageOf, request, statusOf } from "./api";
import { dropLoadCache, loadCacheGeneration, readLoadCache, writeLoadCache } from "./loadCache";
import { useRemovalGuard, useUnsavedWork } from "./unsaved";
/**
 * Loads an API path once per mount and per `path`. Stale while revalidating: the last answer for this path is
 * kept in memory (`loadCache.ts`, shared with `useLeagueLoad` when its key is the same path), so a screen that
 * mounts again shows it at once while the request refreshes it. A different path never shows this one's data.
 *
 * Returns `data`, `fresh` (false while `data` is only the remembered copy), `error`, `status` (the failed request's HTTP status: 404 means gone, so show not-found instead
 * of **Try again**), `reload()` and `setData(value)`.
 */
export function useResource<T>(path: string) {
  const [loaded, setLoaded] = useState<{ path: string; value: T | undefined }>();
  const [failure, setFailure] = useState<{ path: string; message: string; status?: number }>();
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries the request.
  useEffect(() => {
    let active = true;
    const started = loadCacheGeneration();
    setFailure(undefined);
    request<T>(path).then(
      (value) => {
        if (!active) return;
        writeLoadCache(path, value, started);
        setLoaded({ path, value });
      },
      (err) => {
        if (!active) return;
        const status = statusOf(err);
        if (status === 404) {
          dropLoadCache(path);
          setLoaded({ path, value: undefined });
        }
        setFailure({ path, message: messageOf(err), status });
      },
    );
    return () => {
      active = false;
    };
  }, [path, attempt]);
  const setData = useCallback(
    (value: T | undefined) => {
      writeLoadCache(path, value);
      setLoaded({ path, value });
    },
    [path],
  );
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const mine = failure?.path === path ? failure : undefined;
  return {
    data: loaded?.path === path ? loaded.value : readLoadCache<T>(path),
    // False while `data` is only the remembered copy and this mount's own request hasn't answered.
    fresh: loaded?.path === path,
    setData,
    error: mine?.message,
    status: mine?.status,
    reload,
  };
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
