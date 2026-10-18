"use client";

import "./cursor.css";
import { useEffect, useRef } from "react";
import { gsap, FINE_POINTER } from "@/lib/motion/gsap";
import { useCursorEnabled } from "@/lib/cursorPreference";

type CursorState = "default" | "link" | "text" | "disabled" | "zoom" | "next" | "prev";

const TEXT = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="submit"]):not([type="button"]):not([type="color"]), textarea, [contenteditable="true"], [contenteditable=""]';
const DISABLED = 'button:disabled, input:disabled, textarea:disabled, select:disabled, [aria-disabled="true"]';
const CLICKABLE = [
  "a[href]", "button", "summary", "label[for]", "select",
  '[role="button"]', '[role="tab"]', '[role="option"]', '[role="menuitem"]', '[role="switch"]', '[role="checkbox"]',
  'input[type="checkbox"]', 'input[type="radio"]', 'input[type="range"]', 'input[type="file"]', 'input[type="submit"]', 'input[type="button"]',
  ".Polaris-Choice", ".Polaris-DropZone",
].join(", ");
const ICON_STATES = ["zoom", "next", "prev"] as const;

const FOLLOW_SECONDS = 0.07; // near-instant: the cursor sits on the pointer with only a hint of smoothing
const PRESS_SCALE = 0.8;
const BURST_DASHES = 8;

/**
 * What the pointer is over. An element (or ancestor) marked data-cursor="zoom" | "next" | "prev" shows that
 * icon; otherwise links get the ring, text fields the caret bar, disabled controls the dimmed dot.
 */
function stateFor(target: Element | null): CursorState {
  if (!target) return "default";
  const marked = target.closest("[data-cursor]")?.getAttribute("data-cursor");
  const icon = ICON_STATES.find((name) => name === marked);
  if (icon) return icon;
  if (target.closest(DISABLED)) return "disabled";
  if (target.closest(TEXT)) return "text";
  if (marked === "pointer" || target.closest(CLICKABLE)) return "link";
  return "default";
}

interface Look {
  dot: { scaleX: number; scaleY: number; alpha: number };
  ring: { scale: number; alpha: number };
  icon: "zoom" | "next" | "prev" | null;
}

const LOOK: Record<CursorState, Look> = {
  default: { dot: { scaleX: 1, scaleY: 1, alpha: 1 }, ring: { scale: 0.4, alpha: 0 }, icon: null },
  link: { dot: { scaleX: 0.5, scaleY: 0.5, alpha: 1 }, ring: { scale: 1, alpha: 1 }, icon: null },
  text: { dot: { scaleX: 0.2, scaleY: 1.7, alpha: 1 }, ring: { scale: 0.4, alpha: 0 }, icon: null },
  disabled: { dot: { scaleX: 0.9, scaleY: 0.9, alpha: 0.4 }, ring: { scale: 0.4, alpha: 0 }, icon: null },
  zoom: { dot: { scaleX: 0, scaleY: 0, alpha: 0 }, ring: { scale: 0.4, alpha: 0 }, icon: "zoom" },
  next: { dot: { scaleX: 0, scaleY: 0, alpha: 0 }, ring: { scale: 0.4, alpha: 0 }, icon: "next" },
  prev: { dot: { scaleX: 0, scaleY: 0, alpha: 0 }, ring: { scale: 0.4, alpha: 0 }, icon: "prev" },
};

/** Eight short dashes around a centre, like the "click" spark. */
const BURST_ANGLES = Array.from({ length: BURST_DASHES }, (_, index) => (360 / BURST_DASHES) * index);

/**
 * The snipper cursor (GSAP): a solid dot that becomes a ring-with-a-dot over links, a thin bar over text
 * fields, a dimmed dot over disabled controls, and a magnifier or arrow where a page asks for one
 * (data-cursor="zoom" | "next" | "prev"). Clicking fires a burst of dashes. It inverts the colours under it,
 * so it shows on any background. Mouse-like pointers only; the theme menu switches it off.
 */
export function CursorFx() {
  const [enabled] = useCursorEnabled();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = root.current;
    const cursor = element?.querySelector<HTMLElement>(".cx");
    const dot = element?.querySelector<HTMLElement>(".cx-dot");
    const ring = element?.querySelector<HTMLElement>(".cx-ring");
    const burst = element?.querySelector<SVGElement>(".cx-burst");
    const icons = element ? Array.from(element.querySelectorAll<SVGElement>(".cx-icon")) : [];
    if (!enabled || !cursor || !dot || !ring || !burst) return;

    const mm = gsap.matchMedia();
    mm.add(FINE_POINTER, () => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const html = document.documentElement;
      const parts = [dot, ring, burst, ...icons];
      gsap.set(parts, { xPercent: -50, yPercent: -50 });
      gsap.set([ring, burst, ...icons], { autoAlpha: 0 });
      gsap.set(cursor, { x: -100, y: -100, autoAlpha: 0 });

      const moveX = gsap.quickTo(cursor, "x", { duration: reduced ? 0 : FOLLOW_SECONDS, ease: "power2.out" });
      const moveY = gsap.quickTo(cursor, "y", { duration: reduced ? 0 : FOLLOW_SECONDS, ease: "power2.out" });

      let state: CursorState = "default";
      let lastTarget: Element | null = null;
      let pressed = false;
      let shown = false;

      const apply = () => {
        const look = LOOK[state];
        const press = pressed ? PRESS_SCALE : 1;
        const duration = reduced ? 0 : 0.35;
        gsap.to(dot, { scaleX: look.dot.scaleX * press, scaleY: look.dot.scaleY * press, autoAlpha: look.dot.alpha, duration, ease: "power3.out", overwrite: "auto" });
        gsap.to(ring, { scale: look.ring.scale * press, autoAlpha: look.ring.alpha, duration, ease: "power3.out", overwrite: "auto" });
        for (const icon of icons) {
          const active = icon.dataset.icon === look.icon;
          gsap.to(icon, { scale: active ? press : 0.4, autoAlpha: active ? 1 : 0, duration, ease: "back.out(1.6)", overwrite: "auto" });
        }
      };

      const onMove = (event: PointerEvent) => {
        if (event.pointerType !== "mouse") return;
        if (!shown) {
          shown = true;
          html.classList.add("cursor-fx");
          gsap.set(cursor, { x: event.clientX, y: event.clientY, autoAlpha: 1 });
          apply();
        }
        moveX(event.clientX);
        moveY(event.clientY);
        const target = event.target instanceof Element ? event.target : null;
        if (target === lastTarget) return;
        lastTarget = target;
        const next = stateFor(target);
        if (next === state) return;
        state = next;
        apply();
      };
      const onDown = (event: PointerEvent) => {
        if (event.pointerType !== "mouse" || event.button !== 0) return;
        pressed = true;
        apply();
        if (!reduced) {
          gsap.fromTo(burst, { scale: 0.4, autoAlpha: 1 }, { scale: 1.25, autoAlpha: 0, duration: 0.5, ease: "power2.out", overwrite: true });
        }
      };
      const onUp = () => {
        if (!pressed) return;
        pressed = false;
        apply();
      };
      const onLeave = () => {
        gsap.to(cursor, { autoAlpha: 0, duration: 0.2, overwrite: "auto" });
        shown = false;
        html.classList.remove("cursor-fx");
      };

      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerdown", onDown, { passive: true });
      window.addEventListener("pointerup", onUp, { passive: true });
      html.addEventListener("mouseleave", onLeave);

      return () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointerup", onUp);
        html.removeEventListener("mouseleave", onLeave);
        html.classList.remove("cursor-fx");
        gsap.killTweensOf([cursor, ...parts]);
        gsap.set(cursor, { autoAlpha: 0 });
      };
    });

    return () => mm.revert();
  }, [enabled]);

  return (
    <div className="cursor-fx-root" ref={root} aria-hidden="true">
      <div className="cx">
        <svg className="cx-burst" viewBox="0 0 72 72">
          {BURST_ANGLES.map((angle) => (
            <rect key={angle} x="34" y="6" width="4" height="11" rx="1" transform={`rotate(${angle} 36 36)`} />
          ))}
        </svg>
        <div className="cx-ring" />
        <div className="cx-dot" />
        <svg className="cx-icon" data-icon="zoom" viewBox="0 0 34 34">
          <circle cx="14" cy="14" r="9" />
          <path d="M21 21 L30 30" />
        </svg>
        <svg className="cx-icon" data-icon="next" viewBox="0 0 34 34">
          <path d="M3 17 H29" />
          <path d="M20 5 C20 12 24 16 30 17 C24 18 20 22 20 29" />
        </svg>
        <svg className="cx-icon" data-icon="prev" viewBox="0 0 34 34">
          <path d="M31 17 H5" />
          <path d="M14 5 C14 12 10 16 4 17 C10 18 14 22 14 29" />
        </svg>
      </div>
    </div>
  );
}
