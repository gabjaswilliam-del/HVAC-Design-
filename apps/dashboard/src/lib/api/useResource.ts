import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, isAbort } from "./client";

export interface Resource<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  retry: () => void;
}

/**
 * Loads data for `key`, cancelling the previous request when the key changes and
 * ignoring any response for an old key. Data from the previous key stays visible
 * while the next loads only if both keys share the same `context` (for example the
 * same scenario/source/revision); a context change clears it immediately.
 */
export function useResource<T>(
  key: string | null,
  context: string,
  load: (signal: AbortSignal) => Promise<T>,
): Resource<T> {
  const [state, setState] = useState<{ key: string | null; context: string; data?: T; error?: ApiError }>({
    key: null,
    context,
  });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    // Mark loading (key null) but keep same-context data visible until the answer arrives.
    setState((s) => (s.context === context ? { ...s, key: null, error: undefined } : { key: null, context }));
    loadRef.current(controller.signal).then(
      (data) => !controller.signal.aborted && setState({ key, context, data }),
      (e: unknown) => {
        if (controller.signal.aborted || isAbort(e)) return;
        const error = e instanceof ApiError ? e : new ApiError("UNAVAILABLE", String(e), true);
        setState((s) => ({ key, context, data: s.context === context ? s.data : undefined, error }));
      },
    );
    return () => controller.abort();
  }, [key, context, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const current = state.context === context;
  return {
    data: current ? state.data : undefined,
    error: current && state.key === key ? state.error : undefined,
    loading: key !== null && (state.key !== key || !current),
    retry,
  };
}
