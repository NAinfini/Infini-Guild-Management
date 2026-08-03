import { useCallback, useRef, useState } from "react";

export type AdminPendingActionDescriptor = {
  resource: "badge" | "badge-assignment" | "invite" | "role" | "user";
  resourceId: string;
  action: string;
};

function descriptorKey(descriptor: AdminPendingActionDescriptor): string {
  return JSON.stringify([
    descriptor.resource,
    descriptor.resourceId,
    descriptor.action,
  ]);
}

export function useAdminPendingActions() {
  const pendingKeysRef = useRef<ReadonlySet<string>>(new Set());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(pendingKeysRef.current);

  const removePendingKeys = useCallback((keys: string[]) => {
    if (!keys.some((key) => pendingKeysRef.current.has(key))) {
      return;
    }
    const next = new Set(pendingKeysRef.current);
    keys.forEach((key) => next.delete(key));
    pendingKeysRef.current = next;
    setPendingKeys(next);
  }, []);

  const runPendingActions = useCallback(<T,>(
    descriptors: AdminPendingActionDescriptor[],
    action: () => Promise<T>,
  ): Promise<T> | undefined => {
    const keys = descriptors.map(descriptorKey);
    if (keys.length === 0 || keys.some((key) => pendingKeysRef.current.has(key))) {
      return undefined;
    }

    const next = new Set(pendingKeysRef.current);
    keys.forEach((key) => next.add(key));
    pendingKeysRef.current = next;
    setPendingKeys(next);

    try {
      return action().finally(() => removePendingKeys(keys));
    } catch (error) {
      removePendingKeys(keys);
      return Promise.reject(error);
    }
  }, [removePendingKeys]);

  const runPendingAction = useCallback(<T,>(
    descriptor: AdminPendingActionDescriptor,
    action: () => Promise<T>,
  ) => runPendingActions([descriptor], action), [runPendingActions]);

  const isActionPending = useCallback(
    (descriptor: AdminPendingActionDescriptor) => pendingKeysRef.current.has(descriptorKey(descriptor)),
    [pendingKeys],
  );

  return { isActionPending, runPendingAction, runPendingActions };
}
