"use client";

import { useEffect, useRef, useState } from "react";
import {
  PRESETS,
  format,
  isCommittable,
  isEditable,
  normalizeWhileTyping,
  resolveOnBlur
} from "@/lib/numeric-input";

/**
 * Shared numeric controls (spec §5).
 *
 * Every numeric field in the product previously bound a NUMBER to the input and coerced
 * on every keystroke:
 *
 *   value={amount}
 *   onChange={e => setAmount(Number(e.target.value))}
 *
 * That makes the field unusable in two specific ways:
 *   - the field cannot be cleared, because "" coerces to 0 and re-renders as "0"
 *   - a decimal cannot be typed, because "0." coerces to 0 and the dot is eaten
 *
 * These components hold the text being edited as a string and only lift a number when the
 * text is a complete number. The rules live in lib/numeric-input.js and are unit-tested.
 */

type Preset = keyof typeof PRESETS;

type BaseProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  decimals?: number;
  allowNegative?: boolean;
  unit?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  "aria-label"?: string;
  id?: string;
};

function useNumericText({ value, onChange, min, max, decimals, allowNegative }: BaseProps & { decimals: number }) {
  const [text, setText] = useState(() => format(value, decimals));
  const editing = useRef(false);
  // The last value THIS field emitted. Anything else arriving in `value` came from outside
  // — a stepper button, an amount preset, a form reset — and must be shown even mid-edit.
  const emitted = useRef(value);

  // Resync when the value changes from outside. Skipping this while `editing` was the
  // original rule, and it was too broad: the stepper and the SOL presets set the parent
  // value without touching this field's text, so if the input still had focus the effect
  // refused to update and the box displayed a stale number while the real value moved.
  //
  // Chrome hides this because clicking a button blurs the input first. SAFARI DOES NOT
  // FOCUS BUTTONS ON CLICK, so there the field simply appears frozen while + and − change
  // the amount underneath it — on the buy-amount control.
  //
  // Comparing against `emitted` keeps the property that mattered: the user's own typing
  // never resyncs (we emitted that value ourselves), so a cleared field stays cleared and
  // a half-typed "0." keeps its caret.
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    setText(format(value, decimals));
  }, [value, decimals]);

  // A decimals change alone must still reformat, which the guard above would skip.
  useEffect(() => {
    if (!editing.current) setText(format(value, decimals));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decimals]);

  const rules = { decimals, min, max, allowNegative };

  return {
    text,
    onFocus: () => { editing.current = true; },
    onChange: (raw: string) => {
      const next = normalizeWhileTyping(raw);
      // Reject the keystroke rather than accepting and mangling it. Paste goes through
      // exactly the same gate.
      if (!isEditable(next, rules)) return;
      setText(next);
      if (isCommittable(next)) {
        emitted.current = Number(next);
        onChange(Number(next));
      }
    },
    onBlur: () => {
      editing.current = false;
      const resolved = resolveOnBlur(text, rules);
      setText(resolved.text);
      emitted.current = resolved.value;
      if (resolved.value !== value) onChange(resolved.value);
    }
  };
}

/** Free-precision decimal field. Prefer a preset component below where one fits. */
export function DecimalInput(props: BaseProps) {
  const decimals = props.decimals ?? 9;
  const field = useNumericText({ ...props, decimals });
  return (
    <span className={props.className ?? "field-control flex items-center overflow-hidden"}>
      <input
        id={props.id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        disabled={props.disabled}
        aria-label={props["aria-label"]}
        value={field.text}
        onFocus={field.onFocus}
        onChange={(event) => field.onChange(event.target.value)}
        onBlur={field.onBlur}
        className={props.inputClassName ?? "min-w-0 flex-1 bg-transparent px-3 font-mono t-label text-ink outline-none"}
      />
      {props.unit && <span className="ui-label shrink-0 pr-3">{props.unit}</span>}
    </span>
  );
}

/** SOL amounts. 4 decimals shown; never negative. */
export function SolAmountInput(props: Omit<BaseProps, "decimals" | "allowNegative">) {
  return <DecimalInput {...props} {...PRESETS.sol} unit={props.unit ?? "SOL"} />;
}

/** Percentages, clamped 0–100 unless overridden. */
export function PercentInput(props: Omit<BaseProps, "decimals" | "allowNegative">) {
  return (
    <DecimalInput
      {...props}
      decimals={PRESETS.percent.decimals}
      allowNegative={false}
      min={props.min ?? PRESETS.percent.min}
      max={props.max ?? PRESETS.percent.max}
      unit={props.unit ?? "%"}
    />
  );
}

/** Whole numbers — trade counts, retries, quotas. */
export function IntegerInput(props: Omit<BaseProps, "decimals" | "allowNegative">) {
  return <DecimalInput {...props} decimals={0} allowNegative={false} />;
}

/** Internal basis-point entry, 0–10000. */
export function BasisPointInput(props: Omit<BaseProps, "decimals" | "allowNegative">) {
  return (
    <DecimalInput
      {...props}
      decimals={0}
      allowNegative={false}
      min={props.min ?? 0}
      max={props.max ?? 10000}
      unit={props.unit ?? "bps"}
    />
  );
}

/**
 * Decimal field with stepper buttons, matching the existing BotBuilder control.
 * The steppers commit immediately; the text box follows the editing rules above.
 */
export function SteppedNumericField({
  label,
  step = 1,
  ...props
}: BaseProps & { label: string; step?: number }) {
  const decimals = props.decimals ?? 9;
  const field = useNumericText({ ...props, decimals });
  const bump = (delta: number) => {
    const next = resolveOnBlur(String(props.value + delta), { decimals, min: props.min, max: props.max });
    props.onChange(next.value);
  };
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <span className="field-control mt-1.5 flex overflow-hidden">
        <button
          type="button"
          onClick={() => bump(-step)}
          disabled={props.disabled}
          className="grid h-11 w-10 shrink-0 place-items-center border-r border-edge text-dim hover:text-ink disabled:opacity-40"
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          disabled={props.disabled}
          aria-label={label}
          value={field.text}
          onFocus={field.onFocus}
          onChange={(event) => field.onChange(event.target.value)}
          onBlur={field.onBlur}
          className="min-w-0 flex-1 bg-transparent px-2 text-center font-mono t-label text-ink outline-none"
        />
        {props.unit && <span className="self-center pr-2 t-label text-dim">{props.unit}</span>}
        <button
          type="button"
          onClick={() => bump(step)}
          disabled={props.disabled}
          className="grid h-11 w-10 shrink-0 place-items-center border-l border-edge text-dim hover:text-ink disabled:opacity-40"
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </span>
    </label>
  );
}

/**
 * Bare input with the editing rules applied and no wrapper chrome, for call sites that
 * supply their own layout (steppers, inline units, table cells).
 */
export function NumericTextInput({
  value,
  onChange,
  min,
  max,
  decimals = 9,
  allowNegative = false,
  disabled,
  className,
  ariaLabel
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  decimals?: number;
  allowNegative?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const field = useNumericText({ value, onChange, min, max, decimals, allowNegative });
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      disabled={disabled}
      aria-label={ariaLabel}
      value={field.text}
      onFocus={field.onFocus}
      onChange={(event) => field.onChange(event.target.value)}
      onBlur={field.onBlur}
      className={className}
    />
  );
}
