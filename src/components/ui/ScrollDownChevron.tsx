"use client";

// Hotfix 詳情長頁面的浮動捲動引導：純 CSS 動畫的雙箭頭波浪（Double Chevron Pulse），
// 不佔用正常版面高度、不新增空白 Card——以 position:fixed 覆蓋於主內容區底部中央，
// 依 #main-content（見 src/components/app-shell/AppShell.tsx）實際版位計算置中範圍，
// 確保不會偏移到左側 Sidebar，也不受 Sidebar 收合狀態影響。

import { ChevronDown } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

const NEAR_BOTTOM_THRESHOLD_PX = 120;
const OVERFLOW_MARGIN_PX = 180;

export default function ScrollDownChevron() {
  const [visible, setVisible] = useState(false);
  const [region, setRegion] = useState<{ left: number; width: number } | null>(null);
  const pathname = usePathname();

  const updateVisibility = useCallback(() => {
    const root = document.documentElement;
    const hasOverflow = root.scrollHeight > window.innerHeight + OVERFLOW_MARGIN_PX;
    const distanceFromBottom = root.scrollHeight - (window.scrollY + window.innerHeight);
    setVisible(hasOverflow && distanceFromBottom > NEAR_BOTTOM_THRESHOLD_PX);
  }, []);

  const updateRegion = useCallback(() => {
    const main = document.getElementById("main-content");
    if (!main) return;
    const rect = main.getBoundingClientRect();
    setRegion({ left: rect.left, width: rect.width });
  }, []);

  const recompute = useCallback(() => {
    updateVisibility();
    updateRegion();
  }, [updateVisibility, updateRegion]);

  useEffect(() => {
    recompute();
    const main = document.getElementById("main-content");
    // main-content 的寬度會因 Sidebar 收合／展開而改變（非 window resize），一併觀察其
    // 自身尺寸才能在收合切換後正確重新置中；documentElement 則用於捕捉內容高度變化。
    const resizeObserver = new ResizeObserver(recompute);
    resizeObserver.observe(document.documentElement);
    if (main) resizeObserver.observe(main);
    window.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("resize", recompute);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("scroll", updateVisibility);
      window.removeEventListener("resize", recompute);
    };
  }, [recompute, updateVisibility]);

  // Route 切換後（例如簽核送出後導向下一關頁面）內容高度可能不同，需重新計算。
  useEffect(() => {
    recompute();
  }, [pathname, recompute]);

  function scrollToNextSection() {
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-hotfix-scroll-section]"));
    const next = sections.find((section) => section.getBoundingClientRect().top > 96);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (next) {
      next.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      return;
    }
    window.scrollBy({ top: window.innerHeight * 0.7, left: 0, behavior: reduced ? "auto" : "smooth" });
  }

  return (
    <div
      aria-hidden={!visible}
      className="pointer-events-none fixed bottom-0 z-30 flex justify-center pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      style={region ? { left: region.left, width: region.width } : { left: 0, right: 0 }}
    >
      <button
        type="button"
        aria-label="向下捲動查看更多內容"
        tabIndex={visible ? 0 : -1}
        onClick={scrollToNextSection}
        className={`pointer-events-auto rounded-full border border-border bg-white/95 p-2.5 text-primary shadow-overlay backdrop-blur transition-opacity duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <span className="flex flex-col items-center">
          <ChevronDown className="h-4 w-4 animate-scroll-chevron motion-reduce:animate-none" aria-hidden />
          <ChevronDown className="-mt-2 h-4 w-4 animate-scroll-chevron [animation-delay:200ms] motion-reduce:animate-none" aria-hidden />
        </span>
      </button>
    </div>
  );
}
