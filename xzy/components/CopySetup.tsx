"use client";

import { useState } from "react";
import type { ChannelRow, Subscription } from "@/lib/types";

/**
 * The whole configuration step, on one screen: size, daily ceiling, take-profit ladder,
 * stop loss. Kept deliberately short — this is the screen standing between a user and a
 * live automation, and every extra field is another chance to set something wrong.
 */

const DEFAULT_LADDER = [
  { gainPct: 100, sellPct: 50 },
  { gainPct: 300, sellPct: 50 }
];

export function CopySetup({
  channel,
  existing,
  onSaved,
  onCancel
}: {
  channel: ChannelRow;
  existing: Subscription | null;
  onSaved: (subscription: Subscription) => void;
  onCancel: () => void;
}) {
  const [perTradeSol, setPerTradeSol] = useState(String(existing?.perTradeSol ?? 0.1));
  const [maxDailySol, setMaxDailySol] = useState(String(existing?.maxDailySol ?? 1));
  const [stopLossPct, setStopLossPct] = useState(existing?.stopLossPct === null || existing?.stopLossPct === undefined ? "35" : String(existing.stopLossPct));
  const [useStopLoss, setUseStopLoss] = useState(existing ? existing.stopLossPct !== null : true);
  const [levels, setLevels] = useState<{ gainPct: number; sellPct: number }[]>(
    existing && existing.takeProfits.length > 0
      ? existing.takeProfits.map((level) => ({ gainPct: level.gainPct, sellPct: level.sellPct }))
      : DEFAULT_LADDER
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalSell = levels.reduce((sum, level) => sum + (Number(level.sellPct) || 0), 0);

  const updateLevel = (index: number, patch: Partial<{ gainPct: number; sellPct: number }>) => {
    setLevels((current) => current.map((level, i) => (i === index ? { ...level, ...patch } : level)));
  };

  async function save() {
    setSaving(true);
    setError(null);
    const { apiPost } = await import("@/lib/miniapp");
    const res = await apiPost("/api/subscriptions", {
      channelId: channel.id,
      perTradeSol: Number(perTradeSol),
      maxDailySol: Number(maxDailySol),
      takeProfits: levels.map((level) => ({ gainPct: Number(level.gainPct), sellPct: Number(level.sellPct) })),
      stopLossPct: useStopLoss ? Number(stopLossPct) : null
    });
    const body = (await res.json().catch(() => null)) as { subscription?: Subscription; error?: string } | null;
    setSaving(false);

    if (!res.ok || !body?.subscription) {
      setError(body?.error ?? "Could not save. Try again.");
      return;
    }
    onSaved(body.subscription);
  }

  return (
    <section className="flex flex-col gap-5">
      <header>
        <button onClick={onCancel} className="text-xs text-faint hover:text-muted">
          ← Back
        </button>
        <h2 className="mt-2 text-lg font-medium text-ink">{channel.title ?? "Channel"}</h2>
        <p className="text-xs text-faint">Set how this channel's calls are copied.</p>
      </header>

      <Field label="Per trade" hint="SOL spent on each call from this channel.">
        <NumberInput value={perTradeSol} onChange={setPerTradeSol} suffix="SOL" step="0.01" />
      </Field>

      <Field label="Max per day" hint="Copying stops for the day once this is reached. Resets at UTC midnight.">
        <NumberInput value={maxDailySol} onChange={setMaxDailySol} suffix="SOL" step="0.1" />
      </Field>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-ink">Take profit</span>
          <span className={`font-mono text-xs ${totalSell > 100 ? "text-down" : "text-faint"}`}>
            {totalSell}% of position
          </span>
        </div>

        {levels.map((level, index) => (
          <div key={index} className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-1 rounded-lg border border-edge bg-surface px-3 py-2">
              <span className="shrink-0 whitespace-nowrap text-xs text-faint">at +</span>
              <input
                type="number"
                inputMode="decimal"
                value={level.gainPct}
                onChange={(event) => updateLevel(index, { gainPct: Number(event.target.value) })}
                className="w-full min-w-0 bg-transparent font-mono text-sm text-ink outline-none"
              />
              <span className="shrink-0 text-xs text-faint">%</span>
            </div>
            <div className="flex flex-1 items-center gap-1 rounded-lg border border-edge bg-surface px-3 py-2">
              <span className="shrink-0 whitespace-nowrap text-xs text-faint">sell</span>
              <input
                type="number"
                inputMode="decimal"
                value={level.sellPct}
                onChange={(event) => updateLevel(index, { sellPct: Number(event.target.value) })}
                className="w-full min-w-0 bg-transparent font-mono text-sm text-ink outline-none"
              />
              <span className="shrink-0 text-xs text-faint">%</span>
            </div>
            <button
              onClick={() => setLevels((current) => current.filter((_, i) => i !== index))}
              className="shrink-0 px-2 text-faint hover:text-down"
              aria-label={`Remove take-profit level ${index + 1}`}
            >
              ×
            </button>
          </div>
        ))}

        {levels.length < 5 && (
          <button
            onClick={() => setLevels((current) => [...current, { gainPct: 500, sellPct: Math.max(0, 100 - totalSell) }])}
            className="self-start text-xs text-gold hover:underline"
          >
            + Add level
          </button>
        )}
        <p className="text-xs text-faint">Percentages are of the original position, so two 50% levels sell all of it.</p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={useStopLoss}
            onChange={(event) => setUseStopLoss(event.target.checked)}
            className="h-4 w-4 accent-gold"
          />
          <span className="text-sm font-medium text-ink">Stop loss</span>
        </label>
        {useStopLoss && (
          <div className="flex items-center gap-1 rounded-lg border border-edge bg-surface px-3 py-2">
            <span className="shrink-0 whitespace-nowrap text-xs text-faint">sell all at −</span>
            <input
              type="number"
              inputMode="decimal"
              value={stopLossPct}
              onChange={(event) => setStopLossPct(event.target.value)}
              className="w-full min-w-0 bg-transparent font-mono text-sm text-ink outline-none"
            />
            <span className="shrink-0 text-xs text-faint">%</span>
          </div>
        )}
      </div>

      {error && <p className="rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">{error}</p>}

      <button
        onClick={save}
        disabled={saving}
        className="rounded-xl bg-gold px-4 py-3 font-medium text-base disabled:opacity-50"
      >
        {saving ? "Saving…" : existing ? "Update" : "Start copying"}
      </button>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      {children}
      <span className="text-xs text-faint">{hint}</span>
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  suffix,
  step
}: {
  value: string;
  onChange: (value: string) => void;
  suffix: string;
  step: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-edge bg-surface px-3 py-2.5">
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full min-w-0 bg-transparent font-mono text-base text-ink outline-none"
      />
      <span className="shrink-0 text-xs text-faint">{suffix}</span>
    </div>
  );
}
