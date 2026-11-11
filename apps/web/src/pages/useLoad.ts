import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from "react";
import { messageOf } from "../api";

/** Loads data when `key` changes. `setData` lets a page swap in the fresh copy a mutation returned. */
export function useLoad<T>(load: () => Promise<T>, key: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `load` is a fresh closure each render; `key` says when to refetch.
  useEffect(() => {
    let current = true;
    setError(undefined);
    load().then(
      (value) => current && setData(value),
      (err) => current && setError(messageOf(err)),
    );
    return () => {
      current = false;
    };
  }, [key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, reload, setData: setData as Dispatch<SetStateAction<T | undefined>> };
}
