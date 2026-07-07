"use client";
import { useEffect, useRef, useState } from "react";

// Custom glowing cursor: a crisp dot plus a lerped ring that expands over
// interactive elements. Only mounts on fine-pointer (desktop) devices.
export default function CursorGlow() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    setOn(true);
    const pos = { x: innerWidth / 2, y: innerHeight / 2 };
    const rp = { ...pos };
    let raf = 0, hovering = false;

    const move = (e: MouseEvent) => {
      pos.x = e.clientX; pos.y = e.clientY;
      if (dot.current) dot.current.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
      const t = e.target as HTMLElement;
      const h = !!t.closest("a, button, [data-magnetic], input, textarea, [role='button']");
      if (h !== hovering) { hovering = h; ring.current?.classList.toggle("cursor-ring--hover", h); }
    };
    const loop = () => {
      rp.x += (pos.x - rp.x) * 0.18; rp.y += (pos.y - rp.y) * 0.18;
      if (ring.current) ring.current.style.transform = `translate(${rp.x}px, ${rp.y}px)`;
      raf = requestAnimationFrame(loop);
    };
    window.addEventListener("mousemove", move);
    raf = requestAnimationFrame(loop);
    return () => { window.removeEventListener("mousemove", move); cancelAnimationFrame(raf); };
  }, []);

  if (!on) return null;
  return (
    <>
      <div ref={dot} className="pointer-events-none fixed left-0 top-0 z-[100] -ml-1 -mt-1 h-2 w-2 rounded-full bg-white mix-blend-difference" />
      <div ref={ring} className="cursor-ring pointer-events-none fixed left-0 top-0 z-[100] -ml-4 -mt-4 h-8 w-8 rounded-full border border-toxic/70" />
      <style jsx global>{`
        @media (pointer: fine) { * { cursor: none !important; } }
        .cursor-ring { transition: width .2s, height .2s, margin .2s, background .2s, border-color .2s; box-shadow: 0 0 18px rgba(34,224,122,.5); }
        .cursor-ring--hover { width: 3rem; height: 3rem; margin-left: -1.5rem; margin-top: -1.5rem; background: rgba(34,224,122,.15); border-color: rgba(94,242,166,.85); }
      `}</style>
    </>
  );
}
