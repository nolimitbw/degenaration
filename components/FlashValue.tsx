"use client";
import { useEffect, useRef, useState } from "react";

/** Briefly flashes green/red when its numeric value changes between polls — the
    live-ticker feel of DexScreener/Binance rather than a silent value swap. */
export default function FlashValue({ value, children, className = "" }: { value: number | null | undefined; children: React.ReactNode; className?: string }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const a = prev.current, b = value;
    if (a != null && b != null && a !== b) {
      setFlash(b > a ? "up" : "down");
      const t = setTimeout(() => setFlash(null), 700);
      prev.current = b;
      return () => clearTimeout(t);
    }
    prev.current = b;
  }, [value]);

  return <span className={`${className} ${flash === "up" ? "flash-up" : flash === "down" ? "flash-down" : ""}`}>{children}</span>;
}
