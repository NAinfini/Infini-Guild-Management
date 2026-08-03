import { useCallback, useRef, useState } from "react";

export function useKeyedPending() {
  const pendingRef = useRef<Set<string>>(new Set());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(pendingRef.current);

  const runPending = useCallback(async <T,>(key: string, operation: () => Promise<T>) => {
    if (pendingRef.current.has(key)) return undefined;

    const started = new Set(pendingRef.current);
    started.add(key);
    pendingRef.current = started;
    setPendingKeys(started);

    try {
      return await operation();
    } finally {
      const settled = new Set(pendingRef.current);
      settled.delete(key);
      pendingRef.current = settled;
      setPendingKeys(settled);
    }
  }, []);

  return { pendingKeys, runPending };
}
