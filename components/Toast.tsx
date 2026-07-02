"use client";
import { createContext, useCallback, useContext, useState } from "react";

type Toast = { id: string; msg: string; kind: "ok" | "err" };
const Ctx = createContext<(msg: string, kind?: "ok" | "err") => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`animate-in rounded-md border px-4 py-3 font-mono text-xs shadow-lg backdrop-blur ${t.kind === "ok" ? "border-toxic/50 bg-panel text-toxic" : "border-hotpink/50 bg-panel text-hotpink"}`}>
            {t.kind === "ok" ? "✓ " : "✗ "}{t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
