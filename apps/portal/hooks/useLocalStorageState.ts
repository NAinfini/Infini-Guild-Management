import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

function resolveInitialValue<T>(key: string, defaultValue: T): T {
  if (typeof window === "undefined") return defaultValue;

  const stored = window.localStorage.getItem(key);
  if (stored === null) return defaultValue;

  try {
    return JSON.parse(stored) as T;
  } catch (error) {
    console.warn(`Ignoring invalid localStorage value for ${key}`, error);
    return defaultValue;
  }
}

export function useLocalStorageState<T>(
  key: string,
  defaultValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => resolveInitialValue(key, defaultValue));

  const updateValue = useCallback<Dispatch<SetStateAction<T>>>((nextValue) => {
    setValue((current) => {
      const resolved = typeof nextValue === "function"
        ? (nextValue as (previous: T) => T)(current)
        : nextValue;
      try {
        window.localStorage.setItem(key, JSON.stringify(resolved));
      } catch (error) {
        console.warn(`Unable to persist localStorage value for ${key}`, error);
      }
      return resolved;
    });
  }, [key]);

  return [value, updateValue];
}
