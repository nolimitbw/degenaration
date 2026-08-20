import { Metric, Pill, formatX, formatPct } from "./Stat";
import type { ChannelRow, Subscription } from "@/lib/types";

/**
 * One channel in the marketplace.
 *
 * The headline metric is the MEDIAN peak multiple, not the average: one 400x call drags
 * an average somewhere no subscriber actually lived, and a marketplace that rewards that
 * teaches channels to farm lottery tickets.
 */
export function ChannelCard({
  channel,
  subscription,
  onPick,
  onStop
}: {
  channel: ChannelRow;
  subscription: Subscription | null;
  onPick: () => void;
  onStop: () => void;
}) {
  const measured = channel.callsMeasured ?? 0;
  const hasRecord = measured > 0;

  return (
    <article className="rounded-xl border border-edge bg-surface transition-colors focus-within:border-goldDim hover:border-goldDim">
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium text-ink">{channel.title ?? "Untitled channel"}</h3>
            {subscription && !subscription.paused && <Pill tone="gold">Copying</Pill>}
            {subscription?.paused && <Pill>Paused</Pill>}
          </div>
          <p className="truncate text-xs text-faint">
            {channel.username ? `@${channel.username}` : "private channel"}
            {typeof channel.memberCount === "number" && ` · ${channel.memberCount.toLocaleString()} members`}
          </p>
        </div>
        <button
          onClick={onPick}
          className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90 ${
            subscription ? "border border-edge text-muted" : "bg-gold text-base"
          }`}
        >
          {subscription ? "Edit" : "Copy"}
        </button>
      </div>

      <div className="mt-3 border-t border-edge px-4 py-3">
        {hasRecord ? (
          <div className="grid grid-cols-4 gap-3">
            <Metric label="Median" value={formatX(channel.medianPeakX)} tone="gold" />
            <Metric label="Best" value={formatX(channel.bestPeakX)} tone="up" />
            <Metric label="Hit rate" value={formatPct(channel.winRatePct)} />
            <Metric label="Calls" value={String(measured)} />
          </div>
        ) : (
          // Never a row of zeros. No record is not the same as a bad record.
          <p className="text-xs text-faint">
            No track record yet — we only show performance we measured ourselves.
          </p>
        )}
      </div>

      {subscription && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-edge px-4 py-2.5 font-mono text-xs tabular-nums text-muted">
          <span>{subscription.perTradeSol} SOL / call</span>
          <span className="text-faint">·</span>
          <span>max {subscription.maxDailySol}/day</span>
          {subscription.takeProfits.length > 0 && (
            <>
              <span className="text-faint">·</span>
              <span className="text-up">TP {subscription.takeProfits.map((level) => `${level.gainPct}%`).join("/")}</span>
            </>
          )}
          {subscription.stopLossPct !== null && (
            <>
              <span className="text-faint">·</span>
              <span className="text-down">SL {subscription.stopLossPct}%</span>
            </>
          )}
          <button onClick={onStop} className="ml-auto text-faint transition-colors hover:text-down">
            Stop
          </button>
        </div>
      )}
    </article>
  );
}
