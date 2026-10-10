import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { type Backend, getBackend, type Session, type SystemStatus } from "@/backend";

interface BackendContextValue {
  backend: Backend;
  session: Session | null;
  sessionLoading: boolean;
  status: SystemStatus | null;
}

const BackendContext = createContext<BackendContextValue | null>(null);

export function BackendProvider({ children }: { children: ReactNode }) {
  const backend = getBackend();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [status, setStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    backend.getSession().then((s) => {
      setSession(s);
      setSessionLoading(false);
    });
    return backend.onAuthChange((s) => setSession(s));
  }, [backend]);

  useEffect(() => {
    if (!session) return;
    backend.status().then(setStatus).catch(() => setStatus(null));
  }, [backend, session]);

  return <BackendContext.Provider value={{ backend, session, sessionLoading, status }}>{children}</BackendContext.Provider>;
}

export function useBackend() {
  const ctx = useContext(BackendContext);
  if (!ctx) throw new Error("useBackend must be used inside BackendProvider");
  return ctx;
}

/** Load data from the backend and refresh automatically when it changes. */
export function useData<T>(loader: (b: Backend) => Promise<T>, deps: unknown[] = []) {
  const { backend } = useBackend();
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    try {
      const value = await loaderRef.current(backend);
      setData(value);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [backend]);

  useEffect(() => {
    setLoading(true);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, ...deps]);

  useEffect(() => backend.subscribe(() => void reload()), [backend, reload]);

  return { data, error, loading, reload };
}

/** Re-render periodically so relative times ("in 2 min") stay fresh. */
export function useTicker(ms = 15000) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setN((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}
