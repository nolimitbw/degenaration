"use client";
import { useEffect, useState } from "react";
import { Pencil, X } from "lucide-react";
import { useToast } from "@/components/Toast";

/** Small modal to edit the shared quick-buy SOL preset amounts (up to 4). */
export default function QuickBuyEditor({ presets, loaded, onSave }: { presets: number[]; loaded: boolean; onSave: (next: number[]) => Promise<{ error: any }> }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(() => presets.map(String));
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // resync while the modal is open too, so a still-in-flight profile load that
  // resolves after opening doesn't get clobbered by the placeholder-default draft
  useEffect(() => { if (open) setDraft(presets.map(String)); }, [presets]); // eslint-disable-line react-hooks/exhaustive-deps

  function openEditor() {
    setDraft(presets.map(String));
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    const next = draft.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0);
    const { error } = await onSave(next);
    setBusy(false);
    if (error) { toast(error.message || "Could not save — sign in first", "err"); return; }
    toast("Quick-buy amounts saved");
    setOpen(false);
  }

  return (
    <>
      <button onClick={openEditor} className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 font-mono text-xs text-dim transition hover:border-toxic hover:text-toxic">
        <Pencil aria-hidden="true" size={13} /> Edit quick-buy
      </button>
      {open && (
        <div className="fixed inset-0 z-[95] grid place-items-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-lg border border-edge bg-panel p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Quick-buy amounts</h3>
              <button onClick={() => setOpen(false)} aria-label="Close" title="Close" className="grid h-9 w-9 place-items-center rounded-md text-dim hover:bg-edge/40 hover:text-ink"><X aria-hidden="true" size={17} /></button>
            </div>
            <p className="mt-1 text-xs text-dim">Your own SOL presets — shown as one-tap buy buttons on Trenches.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {draft.map((v, i) => (
                <label key={i} className="block">
                  <span className="font-mono text-[10px] uppercase text-dim">Preset {i + 1}</span>
                  <input
                    type="number" step="0.01" min="0.01" value={v}
                    onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? e.target.value : x)))}
                    className="mt-1 w-full rounded-md border border-edge bg-void px-3 py-2 font-mono text-sm outline-none focus:border-toxic"
                  />
                </label>
              ))}
            </div>
            <button onClick={save} disabled={busy || !loaded} className="mt-5 w-full rounded-md bg-toxic py-2.5 font-bold text-white shadow-toxic transition hover:brightness-110 disabled:opacity-50">
              {busy ? "Saving…" : !loaded ? "Loading your presets…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
