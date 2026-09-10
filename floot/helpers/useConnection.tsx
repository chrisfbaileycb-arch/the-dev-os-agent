import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Connection, Provider } from "./runTypes";
import { providerCatalog } from "./providerCatalog";

// Provider settings persist in localStorage WITHOUT the API key. The key lives in memory
// for the session only and is sent per request to the server-side proxy.

const STORAGE_KEY = "ft-connection-v1";

function defaultConnection(): Connection {
  return { mode: "demo", provider: "openrouter", endpoint: providerCatalog.openrouter.endpoint, model: providerCatalog.openrouter.models[0], apiKey: "", maxTokens: 1024 };
}

function load(): Connection {
  const base = defaultConnection();
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<Connection>;
    const provider: Provider = stored.provider && stored.provider in providerCatalog ? stored.provider : base.provider;
    return {
      mode: stored.mode === "remote" ? "remote" : "demo",
      provider,
      endpoint: provider === "custom" ? (typeof stored.endpoint === "string" ? stored.endpoint : "") : providerCatalog[provider].endpoint,
      model: typeof stored.model === "string" ? stored.model : providerCatalog[provider].models[0] ?? "",
      apiKey: "",
      maxTokens: [512, 1024, 2048, 4096].includes(stored.maxTokens ?? 0) ? (stored.maxTokens as number) : 1024,
    };
  } catch {
    return base;
  }
}

interface ConnectionContextType {
  connection: Connection;
  setConnection: (next: Connection | ((prev: Connection) => Connection)) => void;
  switchProvider: (provider: Provider) => void;
  persist: () => void;
  reset: () => void;
}

const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined);

export const ConnectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connection, setConnectionState] = useState<Connection>(defaultConnection);
  useEffect(() => { setConnectionState(load()); }, []);

  const setConnection = useCallback((next: Connection | ((prev: Connection) => Connection)) => {
    setConnectionState((prev) => (typeof next === "function" ? next(prev) : next));
  }, []);

  const switchProvider = useCallback((provider: Provider) => {
    setConnectionState((prev) => ({
      ...prev,
      mode: "remote",
      provider,
      endpoint: provider === "custom" ? (prev.provider === "custom" ? prev.endpoint : "") : providerCatalog[provider].endpoint,
      model: providerCatalog[provider].models[0] ?? "",
      apiKey: "",
    }));
  }, []);

  const persist = useCallback(() => {
    setConnectionState((c) => {
      try {
        const { apiKey: _omit, ...rest } = c;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
      } catch { /* storage unavailable */ }
      return c;
    });
  }, []);

  const reset = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
    setConnectionState(defaultConnection());
  }, []);

  const value = useMemo(() => ({ connection, setConnection, switchProvider, persist, reset }), [connection, setConnection, switchProvider, persist, reset]);
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
};

export const useConnection = (): ConnectionContextType => {
  const context = useContext(ConnectionContext);
  if (context === undefined) throw new Error("useConnection must be used within a ConnectionProvider");
  return context;
};
