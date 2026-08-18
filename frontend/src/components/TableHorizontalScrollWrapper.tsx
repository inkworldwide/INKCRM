import React, { useRef, useState, useEffect, useCallback } from 'react';
import * as Icons from 'lucide-react';

interface TableHorizontalScrollWrapperProps {
  children: React.ReactNode;
  className?: string;
  maxHeight?: string;
}

export const TableHorizontalScrollWrapper: React.FC<TableHorizontalScrollWrapperProps> = ({
  children,
  className = '',
  maxHeight = '72vh'
}) => {
  const topScrollRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);

  const [scrollWidth, setScrollWidth] = useState(0);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const [isHoveringLeftEdge, setIsHoveringLeftEdge] = useState(false);
  const [isHoveringRightEdge, setIsHoveringRightEdge] = useState(false);
  const [isHoveringTopEdge, setIsHoveringTopEdge] = useState(false);
  const [isHoveringBottomEdge, setIsHoveringBottomEdge] = useState(false);

  const animFrameRef = useRef<number | null>(null);
  const isSyncingRef = useRef<boolean>(false);
  const scrollHDirRef = useRef<'left' | 'right' | null>(null);
  const scrollHSpeedRef = useRef<number>(0);
  const scrollVDirRef = useRef<'up' | 'down' | null>(null);
  const scrollVSpeedRef = useRef<number>(0);

  // Measure and update scroll state
  const checkScrollability = useCallback(() => {
    const el = mainScrollRef.current;
    if (!el) return;
    const curScrollWidth = el.scrollWidth;
    const clientWidth = el.clientWidth;
    const scrollLeft = el.scrollLeft;

    const curScrollHeight = el.scrollHeight;
    const clientHeight = el.clientHeight;
    const scrollTop = el.scrollTop;

    setScrollWidth(curScrollWidth);
    setCanScrollLeft(scrollLeft > 3);
    setCanScrollRight(scrollLeft + clientWidth < curScrollWidth - 3);
    setCanScrollUp(scrollTop > 5);
    setCanScrollDown(scrollTop + clientHeight < curScrollHeight - 5);
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
    scrollHDirRef.current = null;
    scrollHSpeedRef.current = 0;
    scrollVDirRef.current = null;
    scrollVSpeedRef.current = 0;
    setIsHoveringLeftEdge(false);
    setIsHoveringRightEdge(false);
    setIsHoveringTopEdge(false);
    setIsHoveringBottomEdge(false);
  }, []);

  const startAutoScroll = useCallback(() => {
    if (animFrameRef.current !== null) return;

    const step = () => {
      const el = mainScrollRef.current;
      if (!el || (!scrollHDirRef.current && !scrollVDirRef.current)) {
        animFrameRef.current = null;
        return;
      }

      let shouldContinue = false;

      // Horizontal auto-scroll
      if (scrollHDirRef.current === 'right') {
        const maxScroll = el.scrollWidth - el.clientWidth;
        if (el.scrollLeft < maxScroll) {
          el.scrollLeft += scrollHSpeedRef.current;
          if (topScrollRef.current) {
            topScrollRef.current.scrollLeft = el.scrollLeft;
          }
          shouldContinue = true;
        }
      } else if (scrollHDirRef.current === 'left') {
        if (el.scrollLeft > 0) {
          el.scrollLeft -= scrollHSpeedRef.current;
          if (topScrollRef.current) {
            topScrollRef.current.scrollLeft = el.scrollLeft;
          }
          shouldContinue = true;
        }
      }

      // Vertical auto-scroll
      if (scrollVDirRef.current === 'down') {
        const maxVScroll = el.scrollHeight - el.clientHeight;
        if (el.scrollTop < maxVScroll) {
          el.scrollTop += scrollVSpeedRef.current;
          shouldContinue = true;
        }
      } else if (scrollVDirRef.current === 'up') {
        if (el.scrollTop > 0) {
          el.scrollTop -= scrollVSpeedRef.current;
          shouldContinue = true;
        }
      }

      checkScrollability();

      if (shouldContinue) {
        animFrameRef.current = requestAnimationFrame(step);
      } else {
        stopAutoScroll();
      }
    };

    animFrameRef.current = requestAnimationFrame(step);
  }, [checkScrollability, stopAutoScroll]);

  // Track cursor position inside table container for 4-directional edge auto-scrolling
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = mainScrollRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const containerWidth = rect.width;
    const containerHeight = rect.height;

    // Check boundaries
    if (mouseX < 0 || mouseX > containerWidth || mouseY < 0 || mouseY > containerHeight) {
      stopAutoScroll();
      return;
    }

    const edgeThreshold = 90;
    const maxHScroll = el.scrollWidth - el.clientWidth;
    const maxVScroll = el.scrollHeight - el.clientHeight;

    let activeH = false;
    let activeV = false;

    // Check Right Edge
    if (mouseX >= containerWidth - edgeThreshold && mouseX <= containerWidth && el.scrollLeft < maxHScroll - 1) {
      const distanceFromEdge = containerWidth - mouseX;
      const ratio = 1 - Math.max(0, distanceFromEdge) / edgeThreshold;
      scrollHDirRef.current = 'right';
      scrollHSpeedRef.current = Math.max(4, Math.round(ratio * 16));
      setIsHoveringRightEdge(true);
      setIsHoveringLeftEdge(false);
      activeH = true;
    } else if (mouseX <= edgeThreshold && mouseX >= 0 && el.scrollLeft > 1) {
      // Check Left Edge
      const distanceFromEdge = mouseX;
      const ratio = 1 - Math.max(0, distanceFromEdge) / edgeThreshold;
      scrollHDirRef.current = 'left';
      scrollHSpeedRef.current = Math.max(4, Math.round(ratio * 16));
      setIsHoveringLeftEdge(true);
      setIsHoveringRightEdge(false);
      activeH = true;
    } else {
      scrollHDirRef.current = null;
      scrollHSpeedRef.current = 0;
      setIsHoveringLeftEdge(false);
      setIsHoveringRightEdge(false);
    }

    // Check Bottom Edge
    if (mouseY >= containerHeight - edgeThreshold && mouseY <= containerHeight && el.scrollTop < maxVScroll - 1) {
      const distanceFromEdge = containerHeight - mouseY;
      const ratio = 1 - Math.max(0, distanceFromEdge) / edgeThreshold;
      scrollVDirRef.current = 'down';
      scrollVSpeedRef.current = Math.max(4, Math.round(ratio * 16));
      setIsHoveringBottomEdge(true);
      setIsHoveringTopEdge(false);
      activeV = true;
    } else if (mouseY <= edgeThreshold && mouseY >= 0 && el.scrollTop > 1) {
      // Check Top Edge
      const distanceFromEdge = mouseY;
      const ratio = 1 - Math.max(0, distanceFromEdge) / edgeThreshold;
      scrollVDirRef.current = 'up';
      scrollVSpeedRef.current = Math.max(4, Math.round(ratio * 16));
      setIsHoveringTopEdge(true);
      setIsHoveringBottomEdge(false);
      activeV = true;
    } else {
      scrollVDirRef.current = null;
      scrollVSpeedRef.current = 0;
      setIsHoveringTopEdge(false);
      setIsHoveringBottomEdge(false);
    }

    if (activeH || activeV) {
      startAutoScroll();
    } else {
      stopAutoScroll();
    }
  };

  const handleMouseLeave = () => {
    stopAutoScroll();
  };

  const scrollByAmount = (hAmount: number) => {
    const el = mainScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: hAmount, behavior: 'smooth' });
    setTimeout(() => {
      if (topScrollRef.current && mainScrollRef.current) {
        topScrollRef.current.scrollLeft = mainScrollRef.current.scrollLeft;
      }
      checkScrollability();
    }, 250);
  };

  const scrollVertically = (vAmount: number) => {
    const el = mainScrollRef.current;
    if (!el) return;
    el.scrollBy({ top: vAmount, behavior: 'smooth' });
    setTimeout(() => {
      checkScrollability();
    }, 250);
  };

  return (
    <div
      className={`relative flex flex-col ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Top Synchronized Control & Scrollbar Bar */}
      <div className="bg-slate-50 dark:bg-slate-800/90 px-3.5 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 select-none flex-wrap sm:flex-nowrap">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
          <div className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-800/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
            <Icons.Move className="w-3.5 h-3.5" />
          </div>
          <span>Interactive Table Scroller</span>
          <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 hidden md:inline">
            • Hover cursor near any edge to auto-scroll (Left, Right, Up, Down)
          </span>
        </div>

        {/* Quick Click 4-Way Scroll Controls */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Horizontal Controls */}
          <div className="flex items-center gap-1 bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => scrollByAmount(-350)}
              disabled={!canScrollLeft}
              className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-all duration-150 flex items-center gap-1 ${
                canScrollLeft
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/50 cursor-pointer shadow-3xs'
                  : 'text-slate-300 dark:text-slate-600 cursor-not-allowed opacity-40'
              }`}
              title="Scroll Left"
            >
              <Icons.ChevronLeft className="w-3.5 h-3.5" />
              <span>Left</span>
            </button>

            <button
              type="button"
              onClick={() => scrollByAmount(350)}
              disabled={!canScrollRight}
              className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-all duration-150 flex items-center gap-1 ${
                canScrollRight
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/50 cursor-pointer shadow-3xs'
                  : 'text-slate-300 dark:text-slate-600 cursor-not-allowed opacity-40'
              }`}
              title="Scroll Right"
            >
              <span>Right</span>
              <Icons.ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Vertical Controls */}
          <div className="flex items-center gap-1 bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => scrollVertically(-300)}
              disabled={!canScrollUp}
              className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-all duration-150 flex items-center gap-1 ${
                canScrollUp
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/50 cursor-pointer shadow-3xs'
                  : 'text-slate-300 dark:text-slate-600 cursor-not-allowed opacity-40'
              }`}
              title="Scroll Up"
            >
              <Icons.ChevronUp className="w-3.5 h-3.5" />
              <span>Up</span>
            </button>

            <button
              type="button"
              onClick={() => scrollVertically(300)}
              disabled={!canScrollDown}
              className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-all duration-150 flex items-center gap-1 ${
                canScrollDown
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/50 cursor-pointer shadow-3xs'
                  : 'text-slate-300 dark:text-slate-600 cursor-not-allowed opacity-40'
              }`}
              title="Scroll Down"
            >
              <span>Down</span>
              <Icons.ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Top High-Visibility Synchronized Scrollbar Track */}
      <div
        ref={topScrollRef}
        onScroll={handleTopScroll}
        className="overflow-x-auto custom-visible-scrollbar bg-slate-100/80 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 py-0.5"
      >
        <div style={{ width: scrollWidth || '100%', height: '4px' }} />
      </div>

      {/* Main Table Scroll Container with 4 Edge Visual Cues */}
      <div className="relative">
        {/* Left Auto-Scroll Edge Cue */}
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

        {/* Right Auto-Scroll Edge Cue */}
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

        {/* Top Auto-Scroll Edge Cue */}
        {canScrollUp && isHoveringTopEdge && (
          <div className="absolute top-0 left-0 right-0 h-10 z-20 pointer-events-none transition-all duration-200 flex items-center justify-center bg-gradient-to-b from-indigo-500/25 to-transparent">
            <div className="w-7 h-7 rounded-full bg-indigo-600 text-white shadow-md flex items-center justify-center">
              <Icons.ChevronUp className="w-4 h-4 animate-pulse" />
            </div>
          </div>
        )}

        {/* Bottom Auto-Scroll Edge Cue */}
        {canScrollDown && isHoveringBottomEdge && (
          <div className="absolute bottom-0 left-0 right-0 h-10 z-20 pointer-events-none transition-all duration-200 flex items-center justify-center bg-gradient-to-t from-indigo-500/25 to-transparent">
            <div className="w-7 h-7 rounded-full bg-indigo-600 text-white shadow-md flex items-center justify-center">
              <Icons.ChevronDown className="w-4 h-4 animate-pulse" />
            </div>
          </div>
        )}

        <div
          ref={mainScrollRef}
          onScroll={handleMainScroll}
          className="overflow-x-auto overflow-y-auto custom-visible-scrollbar"
          style={maxHeight ? { maxHeight } : undefined}
        >
          {children}
        </div>
      </div>
    </div>
  );
};
