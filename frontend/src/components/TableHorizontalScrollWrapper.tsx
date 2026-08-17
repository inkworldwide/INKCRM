import React, { useRef, useState, useEffect, useCallback } from 'react';
import * as Icons from 'lucide-react';

interface TableHorizontalScrollWrapperProps {
  children: React.ReactNode;
  className?: string;
}

export const TableHorizontalScrollWrapper: React.FC<TableHorizontalScrollWrapperProps> = ({
  children,
  className = ''
}) => {
  const topScrollRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);

  const [scrollWidth, setScrollWidth] = useState(0);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isHoveringLeftEdge, setIsHoveringLeftEdge] = useState(false);
  const [isHoveringRightEdge, setIsHoveringRightEdge] = useState(false);

  const animFrameRef = useRef<number | null>(null);
  const isSyncingRef = useRef<boolean>(false);
  const scrollDirectionRef = useRef<'left' | 'right' | null>(null);
  const scrollSpeedRef = useRef<number>(0);

  // Measure and update scroll state
  const checkScrollability = useCallback(() => {
    const el = mainScrollRef.current;
    if (!el) return;
    const curScrollWidth = el.scrollWidth;
    const clientWidth = el.clientWidth;
    const scrollLeft = el.scrollLeft;

    setScrollWidth(curScrollWidth);
    setCanScrollLeft(scrollLeft > 3);
    setCanScrollRight(scrollLeft + clientWidth < curScrollWidth - 3);
  }, []);

  useEffect(() => {
    checkScrollability();
    const handleResize = () => checkScrollability();
    window.addEventListener('resize', handleResize);

    const observer = new MutationObserver(() => {
      checkScrollability();
    });

    if (mainScrollRef.current) {
      observer.observe(mainScrollRef.current, { childList: true, subtree: true, attributes: true });
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [checkScrollability]);

  // Sync scroll positions between top and bottom
  const handleTopScroll = () => {
    if (isSyncingRef.current) return;
    if (topScrollRef.current && mainScrollRef.current) {
      isSyncingRef.current = true;
      mainScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
      checkScrollability();
      requestAnimationFrame(() => {
        isSyncingRef.current = false;
      });
    }
  };

  const handleMainScroll = () => {
    if (isSyncingRef.current) return;
    if (topScrollRef.current && mainScrollRef.current) {
      isSyncingRef.current = true;
      topScrollRef.current.scrollLeft = mainScrollRef.current.scrollLeft;
      checkScrollability();
      requestAnimationFrame(() => {
        isSyncingRef.current = false;
      });
    }
  };

  // Edge auto-scroll loop via requestAnimationFrame
  const stopAutoScroll = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    scrollDirectionRef.current = null;
    scrollSpeedRef.current = 0;
    setIsHoveringLeftEdge(false);
    setIsHoveringRightEdge(false);
  }, []);

  const startAutoScroll = useCallback(() => {
    if (animFrameRef.current !== null) return;

    const step = () => {
      const el = mainScrollRef.current;
      if (!el || !scrollDirectionRef.current) {
        animFrameRef.current = null;
        return;
      }

      const speed = scrollSpeedRef.current;
      if (scrollDirectionRef.current === 'right') {
        const maxScroll = el.scrollWidth - el.clientWidth;
        if (el.scrollLeft < maxScroll) {
          el.scrollLeft += speed;
          if (topScrollRef.current) {
            topScrollRef.current.scrollLeft = el.scrollLeft;
          }
          checkScrollability();
          animFrameRef.current = requestAnimationFrame(step);
        } else {
          stopAutoScroll();
        }
      } else if (scrollDirectionRef.current === 'left') {
        if (el.scrollLeft > 0) {
          el.scrollLeft -= speed;
          if (topScrollRef.current) {
            topScrollRef.current.scrollLeft = el.scrollLeft;
          }
          checkScrollability();
          animFrameRef.current = requestAnimationFrame(step);
        } else {
          stopAutoScroll();
        }
      }
    };

    animFrameRef.current = requestAnimationFrame(step);
  }, [checkScrollability, stopAutoScroll]);

  // Track cursor position inside table container for edge auto-scrolling
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = mainScrollRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const containerWidth = rect.width;
    const containerHeight = rect.height;

    // Ensure mouse is inside vertical bounds of the table
    if (mouseY < 0 || mouseY > containerHeight) {
      stopAutoScroll();
      return;
    }

    const edgeThreshold = 100; // Trigger distance in px from left/right edge
    const maxScroll = el.scrollWidth - el.clientWidth;

    // Check Right Edge
    if (mouseX >= containerWidth - edgeThreshold && mouseX <= containerWidth) {
      if (el.scrollLeft < maxScroll - 1) {
        const distanceFromEdge = containerWidth - mouseX; // 0 to edgeThreshold
        const ratio = 1 - Math.max(0, distanceFromEdge) / edgeThreshold; // 0 to 1
        const speed = Math.max(4, Math.round(ratio * 18));

        scrollDirectionRef.current = 'right';
        scrollSpeedRef.current = speed;
        setIsHoveringRightEdge(true);
        setIsHoveringLeftEdge(false);
        startAutoScroll();
        return;
      }
    }

    // Check Left Edge
    if (mouseX <= edgeThreshold && mouseX >= 0) {
      if (el.scrollLeft > 1) {
        const distanceFromEdge = mouseX; // 0 to edgeThreshold
        const ratio = 1 - Math.max(0, distanceFromEdge) / edgeThreshold;
        const speed = Math.max(4, Math.round(ratio * 18));

        scrollDirectionRef.current = 'left';
        scrollSpeedRef.current = speed;
        setIsHoveringLeftEdge(true);
        setIsHoveringRightEdge(false);
        startAutoScroll();
        return;
      }
    }

    // Not in edge zone
    stopAutoScroll();
  };

  const handleMouseLeave = () => {
    stopAutoScroll();
  };

  const scrollByAmount = (amount: number) => {
    const el = mainScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: amount, behavior: 'smooth' });
    setTimeout(() => {
      if (topScrollRef.current && mainScrollRef.current) {
        topScrollRef.current.scrollLeft = mainScrollRef.current.scrollLeft;
      }
      checkScrollability();
    }, 250);
  };

  return (
    <div
      className={`relative flex flex-col ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Top Synchronized Horizontal Scrollbar Bar */}
      <div className="bg-slate-50 dark:bg-slate-800/90 px-3.5 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 select-none">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
          <div className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-800/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
            <Icons.MoveHorizontal className="w-3.5 h-3.5" />
          </div>
          <span>Table Scroll</span>
          <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 hidden sm:inline">
            • Hover cursor near table edges to auto-scroll left / right
          </span>
        </div>

        {/* Quick Click Left / Right Scroll Controls */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => scrollByAmount(-350)}
            disabled={!canScrollLeft}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all duration-150 flex items-center gap-1 border ${
              canScrollLeft
                ? 'bg-white dark:bg-slate-700 text-slate-700 dark:text-white border-slate-200 dark:border-slate-600 shadow-3xs hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 cursor-pointer'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-300 dark:text-slate-600 border-transparent cursor-not-allowed opacity-50'
            }`}
            title="Scroll Left"
          >
            <Icons.ChevronLeft className="w-3.5 h-3.5" />
            <span>Scroll Left</span>
          </button>

          <button
            type="button"
            onClick={() => scrollByAmount(350)}
            disabled={!canScrollRight}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all duration-150 flex items-center gap-1 border ${
              canScrollRight
                ? 'bg-white dark:bg-slate-700 text-slate-700 dark:text-white border-slate-200 dark:border-slate-600 shadow-3xs hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 cursor-pointer'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-300 dark:text-slate-600 border-transparent cursor-not-allowed opacity-50'
            }`}
            title="Scroll Right"
          >
            <span>Scroll Right</span>
            <Icons.ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Top High-Visibility Scrollbar Track */}
      <div
        ref={topScrollRef}
        onScroll={handleTopScroll}
        className="overflow-x-auto custom-visible-scrollbar bg-slate-100/70 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800 py-0.5"
      >
        <div style={{ width: scrollWidth || '100%', height: '4px' }} />
      </div>

      {/* Main Table Scroll Container */}
      <div className="relative">
        {/* Left Auto-Scroll Edge Hotspot & Glowing Visual Cue */}
        {canScrollLeft && (
          <div
            className={`absolute left-0 top-0 bottom-0 w-14 z-20 pointer-events-none transition-all duration-200 flex items-center justify-start pl-2 bg-gradient-to-r from-indigo-500/25 via-indigo-500/10 to-transparent ${
              isHoveringLeftEdge ? 'opacity-100 scale-105' : 'opacity-60'
            }`}
          >
            <div className="w-7 h-7 rounded-full bg-indigo-600 text-white shadow-md flex items-center justify-center">
              <Icons.ChevronLeft className="w-4 h-4 animate-pulse" />
            </div>
          </div>
        )}

        {/* Right Auto-Scroll Edge Hotspot & Glowing Visual Cue */}
        {canScrollRight && (
          <div
            className={`absolute right-0 top-0 bottom-0 w-14 z-20 pointer-events-none transition-all duration-200 flex items-center justify-end pr-2 bg-gradient-to-l from-indigo-500/25 via-indigo-500/10 to-transparent ${
              isHoveringRightEdge ? 'opacity-100 scale-105' : 'opacity-60'
            }`}
          >
            <div className="w-7 h-7 rounded-full bg-indigo-600 text-white shadow-md flex items-center justify-center">
              <Icons.ChevronRight className="w-4 h-4 animate-pulse" />
            </div>
          </div>
        )}

        <div
          ref={mainScrollRef}
          onScroll={handleMainScroll}
          className="overflow-x-auto custom-visible-scrollbar"
        >
          {children}
        </div>
      </div>
    </div>
  );
};
