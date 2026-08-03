"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export default function ScrollDownChevron() {
  const [visible, setVisible] = useState(false);

  const updateVisibility = useCallback(() => {
    const root = document.documentElement;
    const hasOverflow = root.scrollHeight > window.innerHeight + 180;
    const nearBottom = window.scrollY + window.innerHeight >= root.scrollHeight - 120;
    setVisible(hasOverflow && !nearBottom);
  }, []);

  useEffect(() => {
    updateVisibility();
    const observer = new ResizeObserver(updateVisibility);
    observer.observe(document.documentElement);
    window.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("resize", updateVisibility);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", updateVisibility);
      window.removeEventListener("resize", updateVisibility);
    };
  }, [updateVisibility]);

  function scrollToNextSection() {
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-hotfix-scroll-section]"));
    const next = sections.find((section) => section.getBoundingClientRect().top > 96);
    if (!next) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    next.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }

  return (
    <button
      type="button"
      aria-label="向下查看更多內容"
      onClick={scrollToNextSection}
      className={`fixed bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-full border border-border bg-white/95 p-2.5 text-primary shadow-overlay backdrop-blur transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none ${visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"}`}
    >
      <span className="animate-scroll-chevron flex flex-col items-center motion-reduce:animate-none">
        <ChevronDown className="h-4 w-4" aria-hidden />
        <ChevronDown className="-mt-2 h-4 w-4" aria-hidden />
      </span>
    </button>
  );
}
