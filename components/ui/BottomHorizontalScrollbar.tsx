"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";

type BottomHorizontalScrollbarProps = {
  targetRef: RefObject<HTMLDivElement>;
  /** The same id as the overflow container, not the table inside it. */
  targetId: string;
  label?: string;
  hideWhen?: boolean;
  minViewportWidth?: number;
};

type Geometry = {
  visible: boolean;
  left: number;
  width: number;
  bottom: number;
  viewportWidth: number;
  contentWidth: number;
  max: number;
  position: number;
};

const initialGeometry: Geometry = { visible: false, left: 0, width: 0, bottom: 0, viewportWidth: 0, contentWidth: 0, max: 0, position: 0 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * A persistent companion to an existing LTR overflow container. The real
 * container remains the single source of scroll position, so its native
 * scrollbar, trackpad and touch scrolling continue to work normally.
 *
 * Render this AFTER the page's table and footer. Its conditional spacer keeps
 * the fixed control from permanently covering the final row or pagination.
 */
export function BottomHorizontalScrollbar({
  targetRef,
  targetId,
  label = "표 좌우 이동",
  hideWhen = false,
  minViewportWidth = 768,
}: BottomHorizontalScrollbarProps) {
  const [geometry, setGeometry] = useState(initialGeometry);
  const railRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; offset: number } | null>(null);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    let active = true;
    let frame: number | null = null;
    let observedContent: Element | null = null;

    const measure = () => {
      frame = null;
      if (!active) return;
      const rect = target.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportRight = viewportLeft + (viewport?.width ?? (document.documentElement.clientWidth || window.innerWidth));
      const left = Math.max(rect.left, viewportLeft);
      const width = Math.max(0, Math.min(rect.right, viewportRight) - left);
      const max = Math.max(0, target.scrollWidth - target.clientWidth);
      const visibility = window.getComputedStyle(target).visibility;
      const next: Geometry = {
        visible: window.innerWidth >= minViewportWidth && target.isConnected && target.getClientRects().length > 0
          && visibility !== "hidden" && visibility !== "collapse" && rect.height > 0 && width >= 120
          && target.clientWidth > 0 && max > 1,
        left,
        width,
        bottom: viewport ? Math.max(0, window.innerHeight - viewport.offsetTop - viewport.height) : 0,
        viewportWidth: target.clientWidth,
        contentWidth: target.scrollWidth,
        max,
        position: clamp(target.scrollLeft, 0, max),
      };
      setGeometry(previous => Object.keys(next).every(key => previous[key as keyof Geometry] === next[key as keyof Geometry]) ? previous : next);
    };
    const schedule = () => {
      if (active && frame === null) frame = window.requestAnimationFrame(measure);
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    const observeContent = () => {
      // A table's intrinsic width can change while its overflow wrapper stays
      // the same size (new columns, fonts, pagination or realtime content).
      const content = target.firstElementChild;
      if (content === observedContent) return;
      if (observedContent) resizeObserver?.unobserve(observedContent);
      observedContent = content;
      if (content) resizeObserver?.observe(content);
    };
    resizeObserver?.observe(target);
    resizeObserver?.observe(document.documentElement);
    observeContent();
    const mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => {
      observeContent();
      schedule();
    });
    mutationObserver?.observe(target, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
    // Inherited visibility and layout changes must also hide/reposition the
    // dock, without observing unrelated document contents or polling.
    for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
      mutationObserver?.observe(ancestor, { attributes: true, attributeFilter: ["class", "style", "hidden"] });
    }
    target.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    measure();

    return () => {
      active = false;
      if (frame !== null) window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      target.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      dragRef.current = null;
    };
  }, [targetRef, minViewportWidth]);

  // This is the only write path; measurements and native scroll events only
  // read from the target, avoiding feedback loops or mismatched proxy widths.
  const scrollTo = useCallback((position: number) => {
    const target = targetRef.current;
    if (!target) return;
    const max = Math.max(0, target.scrollWidth - target.clientWidth);
    const next = clamp(position, 0, max);
    if (target.scrollLeft !== next) target.scrollLeft = next;
    setGeometry(previous => ({ ...previous, max, position: clamp(target.scrollLeft, 0, max) }));
  }, [targetRef]);

  useEffect(() => {
    if (hideWhen || !geometry.visible) dragRef.current = null;
  }, [hideWhen, geometry.visible]);

  const moveBy = (amount: number) => scrollTo((targetRef.current?.scrollLeft ?? 0) + amount);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const page = Math.max(40, geometry.viewportWidth * 0.9);
    switch (event.key) {
      case "ArrowLeft": moveBy(-40); break;
      case "ArrowRight": moveBy(40); break;
      case "PageUp": moveBy(-page); break;
      case "PageDown": moveBy(page); break;
      case "Home": scrollTo(0); break;
      case "End": scrollTo(geometry.max); break;
      default: return;
    }
    event.preventDefault();
  };

  const pointerPosition = (event: PointerEvent<HTMLDivElement>, offset: number) => {
    const rail = railRef.current;
    const target = targetRef.current;
    if (!rail || !target) return;
    const rect = rail.getBoundingClientRect();
    const thumbWidth = Math.min(rect.width, Math.max(32, rect.width * target.clientWidth / Math.max(1, target.scrollWidth)));
    const travel = rect.width - thumbWidth;
    if (travel > 0) scrollTo((event.clientX - rect.left - offset) / travel * Math.max(0, target.scrollWidth - target.clientWidth));
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const thumbWidth = Math.min(rect.width, Math.max(32, rect.width * geometry.viewportWidth / Math.max(1, geometry.contentWidth)));
    const thumbLeft = rect.left + (rect.width - thumbWidth) * (geometry.max ? geometry.position / geometry.max : 0);
    const onThumb = event.clientX >= thumbLeft && event.clientX <= thumbLeft + thumbWidth;
    const offset = onThumb ? event.clientX - thumbLeft : thumbWidth / 2;
    dragRef.current = { pointerId: event.pointerId, offset };
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    if (!onThumb) pointerPosition(event, offset);
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  if (!geometry.visible) return null;
  const progress = geometry.max ? geometry.position / geometry.max : 0;
  return <>
    <div aria-hidden="true" data-bottom-scrollbar-spacer className="print:hidden" style={{ height: "calc(60px + env(safe-area-inset-bottom, 0px))" }} />
    {!hideWhen && createPortal(
      <div data-bottom-horizontal-scrollbar className="fixed z-30 flex items-center gap-2 rounded-t-xl border border-slate-300 bg-white px-2 shadow-[0_-3px_12px_rgb(15_23_42_/_0.10)] print:hidden"
        style={{ left: geometry.left, width: geometry.width, bottom: geometry.bottom, height: "calc(52px + env(safe-area-inset-bottom, 0px))", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <button type="button" aria-label={`${label}: 왼쪽`} title="왼쪽으로 이동" disabled={geometry.position <= 0} onClick={() => moveBy(-80)}
          className="grid size-8 shrink-0 place-items-center rounded-md text-xl text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:cursor-default disabled:opacity-30">‹</button>
        <div ref={railRef} role="scrollbar" tabIndex={0} aria-label={label} aria-controls={targetId} aria-orientation="horizontal"
          aria-valuemin={0} aria-valuemax={Math.round(geometry.max)} aria-valuenow={Math.round(geometry.position)} aria-valuetext={`${Math.round(progress * 100)}%`}
          title="드래그하거나 방향키, Home, End 키로 좌우 이동"
          className="relative h-8 min-w-0 flex-1 cursor-pointer rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          style={{ touchAction: "none", userSelect: "none" }} onKeyDown={onKeyDown} onPointerDown={onPointerDown}
          onPointerMove={event => { const drag = dragRef.current; if (drag?.pointerId === event.pointerId) { event.preventDefault(); pointerPosition(event, drag.offset); } }}
          onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { dragRef.current = null; }}>
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-3 h-2 rounded-full bg-slate-200" />
          <div aria-hidden="true" data-bottom-scrollbar-thumb className="pointer-events-none absolute top-2 h-4 rounded-full bg-slate-500 shadow-sm"
            style={{ width: `${Math.min(100, geometry.viewportWidth / Math.max(1, geometry.contentWidth) * 100)}%`, minWidth: "min(32px, 100%)", left: `${progress * 100}%`, transform: `translateX(-${progress * 100}%)` }} />
        </div>
        <button type="button" aria-label={`${label}: 오른쪽`} title="오른쪽으로 이동" disabled={geometry.position >= geometry.max} onClick={() => moveBy(80)}
          className="grid size-8 shrink-0 place-items-center rounded-md text-xl text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:cursor-default disabled:opacity-30">›</button>
      </div>, document.body)}
  </>;
}
