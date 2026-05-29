"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  /** The visible label (clickable / hoverable). */
  children: React.ReactNode;
  /** Short explanation shown in the popover. Markdown-free; one-liner preferred. */
  body: React.ReactNode;
  /** Width of the popover (default 18rem). */
  width?: string;
  /** "above" (default) or "below" — pick the side with more room. */
  side?: "above" | "below";
  /**
   * Horizontal anchor relative to the trigger. "center" (default) can overflow when the
   * trigger sits near a container edge; use "right" for right-aligned values so the
   * popover opens leftward (and "left" for the mirror case).
   */
  align?: "left" | "center" | "right";
};

/**
 * Inline learn-in-place affordance. The wrapped text gets a subtle dotted underline.
 * Hover (desktop) or tap (mobile) reveals a small popover with the explanation.
 */
export function Hint({
  children,
  body,
  width = "18rem",
  side = "above",
  align = "center",
}: Props) {
  const alignClass =
    align === "right"
      ? "right-0"
      : align === "left"
        ? "left-0"
        : "left-1/2 -translate-x-1/2";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span
      ref={ref}
      tabIndex={0}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={(e) => {
        e.stopPropagation();
        setOpen((x) => !x);
      }}
      className="relative inline-block border-b border-dotted border-current/40 cursor-help outline-none focus:border-current"
      aria-describedby={open ? "hint-popover" : undefined}
    >
      {children}
      {open && (
        <span
          id="hint-popover"
          role="tooltip"
          // The popover is rendered as inline span content but positioned absolutely.
          className={`absolute ${
            side === "above" ? "bottom-full mb-2" : "top-full mt-2"
          } ${alignClass} z-50 block border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-[11px] leading-relaxed text-[var(--color-ink)] font-normal normal-case tracking-normal shadow-md text-left`}
          style={{ width }}
        >
          {body}
        </span>
      )}
    </span>
  );
}
