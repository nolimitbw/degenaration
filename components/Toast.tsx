"use client";
import { createContext, useCallback, useContext, useState } from "react";

type Kind = "ok" | "err" | "info";
type Toast = { id: string; msg: string; kind: Kind };
const Ctx = createContext<(msg: string, kind?: Kind) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((msg: string, kind: Kind = "ok") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`animate-in rounded-md border px-4 py-3 font-mono text-xs shadow-lg backdrop-blur bg-panel ${t.kind === "ok" ? "border-toxic/50 text-toxic" : t.kind === "info" ? "border-cyber/50 text-cyber" : "border-hotpink/50 text-hotpink"}`}>
            {t.kind === "ok" ? "✓ " : t.kind === "info" ? "• " : "✗ "}{t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
