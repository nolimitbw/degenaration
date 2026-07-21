"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, CircleAlert, Info } from "lucide-react";

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
          <div key={t.id} role={t.kind === "err" ? "alert" : "status"} className={`flex max-w-sm items-start gap-2 animate-in rounded-md border bg-panel px-4 py-3 font-mono text-xs shadow-lg backdrop-blur ${t.kind === "ok" ? "border-toxic/50 text-toxic" : t.kind === "info" ? "border-cyber/50 text-cyber" : "border-hotpink/50 text-hotpink"}`}>
            {t.kind === "ok" ? <CheckCircle2 aria-hidden="true" size={15} className="mt-px shrink-0" /> : t.kind === "info" ? <Info aria-hidden="true" size={15} className="mt-px shrink-0" /> : <CircleAlert aria-hidden="true" size={15} className="mt-px shrink-0" />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
