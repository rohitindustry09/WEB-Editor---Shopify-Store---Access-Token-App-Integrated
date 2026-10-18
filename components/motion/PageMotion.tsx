"use client";

import { useRef, type ReactNode } from "react";
import { gsap, ScrollTrigger, useGSAP, MOTION_OK } from "@/lib/motion/gsap";

/** The top-level blocks of a page: its layout sections, or else the direct children of the page content (looking inside a single stack). */
function pageBlocks(root: HTMLElement): HTMLElement[] {
  const sections = root.querySelectorAll<HTMLElement>(".Polaris-Layout__Section");
  if (sections.length > 0) return Array.from(sections);
  const content = Array.from(root.querySelectorAll<HTMLElement>(".Polaris-Page__Content > *"));
  if (content.length === 1 && content[0].classList.contains("Polaris-BlockStack")) {
    return Array.from(content[0].children).filter((child): child is HTMLElement => child instanceof HTMLElement);
  }
  return content;
}

const HYDRATION_WATCH = ".Polaris-Page-Header__TitleWrapper, .Polaris-Page-Header__RightAlign, .Polaris-Layout__Section, .Polaris-Page__Content > *, .reveal";
const MAX_HYDRATION_WAIT_FRAMES = 120;

/** React tags every DOM node it manages with a fiber key once the node is hydrated (or created on the client). */
function isHydrated(node: Element): boolean {
  return Object.keys(node).some((key) => key.startsWith("__reactFiber$"));
}

/**
 * Calls `run` once React has hydrated everything the entrance will animate. GSAP writes inline styles
 * (opacity, transform) immediately; doing that before hydration finishes makes React report a mismatch
 * ("a tree hydrated but some attributes didn't match") and throw the server HTML away. Gives up waiting
 * after about two seconds so a slow page still animates. Returns a function that cancels the wait.
 */
function whenHydrated(root: HTMLElement, run: () => void): () => void {
  let frames = 0;
  let frame = 0;
  const tick = () => {
    const pending = Array.from(root.querySelectorAll(HYDRATION_WATCH)).some((node) => !isHydrated(node));
    if (!pending || ++frames > MAX_HYDRATION_WAIT_FRAMES) return run();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

/**
 * Choreographs a page as it opens (GSAP): the title slides in, the page's blocks rise one
 * after another, and anything marked `.reveal` eases in again as it scrolls into view
 * (ScrollTrigger inside the content panel). It is keyed by the route, so every navigation
 * replays it. Visitors who ask for reduced motion see the page immediately, unanimated.
 */
export function PageMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const element = root.current;
      if (!element) return;
      // Releases the "hidden until animated" safety rule in ui.css (which un-hides itself after 1.5 s even if this never runs).
      // Without motion there is nothing to wait for; with motion it is released right as the entrance starts.
      if (!window.matchMedia(MOTION_OK).matches) element.dataset.motionReady = "1";

      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const panel = element.closest<HTMLElement>(".shell-panel");

        let cancelWait: (() => void) | undefined;

        const play = () => {
          element.dataset.motionReady = "1";
          const headers = element.querySelectorAll(".Polaris-Page-Header__TitleWrapper, .Polaris-Page-Header__RightAlign");
          const blocks = pageBlocks(element);

          if (headers.length > 0) gsap.from(headers, { y: 14, autoAlpha: 0, duration: 0.7, ease: "power3.out", clearProps: "transform,opacity,visibility" });
          if (blocks.length > 0) gsap.from(blocks, {
            y: 26,
            autoAlpha: 0,
            duration: 0.85,
            ease: "power3.out",
            delay: 0.06,
            stagger: { amount: Math.min(0.5, blocks.length * 0.07) },
            clearProps: "transform,opacity,visibility",
          });

          // Scroll reveal: hidden now, shown as each batch enters the panel's viewport.
          const reveals = element.querySelectorAll<HTMLElement>(".reveal");
          if (reveals.length > 0 && panel) {
            gsap.set(reveals, { autoAlpha: 0, y: 28 });
            ScrollTrigger.batch(reveals, {
              scroller: panel,
              start: "top 94%",
              once: true,
              onEnter: (batch) =>
                gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.8, ease: "power3.out", stagger: 0.08, overwrite: true, clearProps: "transform,opacity,visibility" }),
            });
          }
        };

        // While a skeleton is showing it is the page for now; the entrance plays when the real page takes its place.
        let showingSkeleton = element.querySelector("[data-skeleton]") !== null;
        const playWhenHydrated = () => {
          cancelWait?.();
          cancelWait = whenHydrated(element, play);
        };
        if (!showingSkeleton) playWhenHydrated();

        const watcher = new MutationObserver(() => {
          const stillSkeleton = element.querySelector("[data-skeleton]") !== null;
          if (showingSkeleton && !stillSkeleton) playWhenHydrated();
          showingSkeleton = stillSkeleton;
        });
        watcher.observe(element, { childList: true, subtree: true });
        return () => {
          watcher.disconnect();
          cancelWait?.();
        };
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <div className="page-transition" ref={root}>
      {children}
    </div>
  );
}
