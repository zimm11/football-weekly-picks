import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { messageOf } from "../api";

/**
 * Loads data when `key` changes, and again on `reload()`. `setData` lets a page swap in the fresh copy a
 * mutation returned; a load already under way when that happens is dropped, so a background refresh can't
 * put back the data from before the change.
 */
export function useLoad<T>(load: () => Promise<T>, key: string) {
  const [data, setDataState] = useState<T>();
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);
  /** Bumped by every `setData`, so a load can tell whether newer data arrived while it was running. */
  const writes = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `load` is a fresh closure each render; `key` says when to refetch.
  useEffect(() => {
    let current = true;
    const startedAt = writes.current;
    const fresh = () => current && writes.current === startedAt;
    setError(undefined);
    load().then(
      (value) => fresh() && setDataState(value),
      (err) => fresh() && setError(messageOf(err)),
    );
    return () => {
      current = false;
    };
  }, [key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const setData = useCallback<Dispatch<SetStateAction<T | undefined>>>((value) => {
    writes.current += 1;
    setDataState(value);
  }, []);
  return { data, error, reload, setData };
}
