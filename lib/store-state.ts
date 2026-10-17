import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

// Local optimistic edits advance a field's version immediately. Read snapshots
// use the third setter, so a response started before an edit cannot overwrite it.
// Existing write callbacks keep the standard React setState interface unchanged.
export function useStoreFieldState<T>(initial: T | (() => T), versions: MutableRefObject<Record<string, number>>, key: string) {
  const [value, applyRead] = useState<T>(initial);
  const setLocal: Dispatch<SetStateAction<T>> = useCallback(next => {
    versions.current[key] = (versions.current[key] ?? 0) + 1;
    applyRead(next);
  }, [key, versions]);
  return [value, setLocal, applyRead] as const;
}
