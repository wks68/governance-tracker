"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

interface TooltipPosition {
  left: number;
  top: number;
  width: number;
  placement: "top" | "bottom";
}

export default function Tooltip({ label, content }: { label: string; content: string }) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(400, Math.max(280, window.innerWidth - 24));
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 12);
    const placement = rect.bottom + 180 < window.innerHeight ? "bottom" : "top";
    setPosition({
      left,
      top: placement === "bottom" ? rect.bottom + 10 : rect.top - 10,
      width,
      placement,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (!triggerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, updatePosition]);

  return (
    <span className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface text-xs font-bold text-text-muted transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        ?
      </button>
      {open && position && (
        <span
          id={tooltipId}
          role="tooltip"
          className="animate-tooltip-in fixed z-40 whitespace-pre-line rounded-xl border border-border bg-surface px-4 py-3 text-left text-xs font-normal leading-5 text-text-secondary shadow-overlay"
          style={{
            left: position.left,
            top: position.top,
            width: position.width,
            transform: position.placement === "top" ? "translateY(-100%)" : undefined,
          }}
        >
          {content}
        </span>
      )}
    </span>
  );
}
