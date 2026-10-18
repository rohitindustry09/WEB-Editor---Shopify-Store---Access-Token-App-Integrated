"use client";

import { useEffect } from "react";
import { gsap, FINE_POINTER, MOTION_OK } from "@/lib/motion/gsap";

/**
 * The motion that belongs to the app shell rather than to a page (GSAP):
 *  - the sidebar's items stagger in when the app opens,
 *  - the aurora behind the panel drifts on slow, randomised loops,
 *  - a thin brass line along the top of the panel shows how far the page is scrolled,
 *  - on mouse-like pointers: bento tiles tilt toward the cursor and a glow follows it, and
 *    primary buttons' labels lean toward the cursor (a "magnetic" feel).
 * It renders nothing: it finds the shell in the DOM and cleans up everything on unmount.
 * Every effect is skipped for visitors who ask for reduced motion.
 */
export function ShellMotion() {
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".shell");
    if (!shell) return;
    const mm = gsap.matchMedia();

    mm.add(MOTION_OK, () => {
      gsap.from(".shell-top > *, .shell-section-title, .shell-nav .shell-row, .shell-bottom > *", {
        x: -16,
        autoAlpha: 0,
        duration: 0.6,
        ease: "power3.out",
        stagger: 0.025,
        clearProps: "transform,opacity,visibility",
      });

      gsap.utils.toArray<HTMLElement>(".shell-aurora span").forEach((blob, index) => {
        gsap.to(blob, {
          x: gsap.utils.random(-140, 140),
          y: gsap.utils.random(-90, 90),
          scale: gsap.utils.random(0.9, 1.22),
          duration: gsap.utils.random(14, 22),
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
          delay: -index * 4,
        });
      });

      const panel = shell.querySelector<HTMLElement>(".shell-panel");
      const bar = shell.querySelector<HTMLElement>(".shell-progress");
      let onScroll: (() => void) | null = null;
      if (panel && bar) {
        const setScale = gsap.quickSetter(bar, "scaleX");
        const setOpacity = gsap.quickSetter(bar, "opacity");
        onScroll = () => {
          const scrollable = panel.scrollHeight - panel.clientHeight;
          const ratio = scrollable > 2 ? panel.scrollTop / scrollable : 0;
          setScale(ratio);
          setOpacity(ratio > 0.005 ? 1 : 0);
        };
        panel.addEventListener("scroll", onScroll, { passive: true });
      }
      return () => {
        if (panel && onScroll) panel.removeEventListener("scroll", onScroll);
      };
    });

    mm.add(`${MOTION_OK} and ${FINE_POINTER}`, () => {
      const onMove = (event: PointerEvent) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const tile = target.closest<HTMLElement>("a.bento-tile");
        if (tile) {
          const rect = tile.getBoundingClientRect();
          const x = (event.clientX - rect.left) / rect.width;
          const y = (event.clientY - rect.top) / rect.height;
          tile.style.setProperty("--mx", `${event.clientX - rect.left}px`);
          tile.style.setProperty("--my", `${event.clientY - rect.top}px`);
          gsap.to(tile, { rotateX: (y - 0.5) * -6, rotateY: (x - 0.5) * 6, y: -3, transformPerspective: 900, duration: 0.45, ease: "power2.out", overwrite: "auto" });
        }

        const button = target.closest<HTMLElement>(".Polaris-Button--variantPrimary:not([disabled])");
        const label = button?.querySelector<HTMLElement>(".Polaris-Button__Content");
        if (button && label) {
          const rect = button.getBoundingClientRect();
          gsap.to(label, {
            x: (event.clientX - (rect.left + rect.width / 2)) * 0.16,
            y: (event.clientY - (rect.top + rect.height / 2)) * 0.28,
            duration: 0.3,
            ease: "power3.out",
            overwrite: "auto",
          });
        }
      };

      const onOut = (event: PointerEvent) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const left = (element: Element | null) => element && !element.contains(event.relatedTarget as Node | null);

        const tile = target.closest<HTMLElement>("a.bento-tile");
        if (tile && left(tile)) {
          gsap.to(tile, { rotateX: 0, rotateY: 0, y: 0, duration: 0.7, ease: "power3.out", overwrite: "auto" });
        }
        const button = target.closest<HTMLElement>(".Polaris-Button--variantPrimary");
        const label = button?.querySelector<HTMLElement>(".Polaris-Button__Content");
        if (button && label && left(button)) {
          gsap.to(label, { x: 0, y: 0, duration: 0.8, ease: "elastic.out(1, 0.4)", overwrite: "auto" });
        }
      };

      shell.addEventListener("pointermove", onMove, { passive: true });
      shell.addEventListener("pointerout", onOut, { passive: true });
      return () => {
        shell.removeEventListener("pointermove", onMove);
        shell.removeEventListener("pointerout", onOut);
      };
    });

    return () => mm.revert();
  }, []);

  return null;
}

/**
 * Keeps the sidebar's brass marker beside the open page. A group opening, or the sidebar
 * collapsing, moves items for a third of a second — so the marker re-measures on every frame
 * for that long and glides after its item instead of jumping to where the item will end up.
 */
export function useSidebarMarker(activeKey: string) {
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>(".shell-nav");
    const marker = nav?.querySelector<HTMLElement>(".shell-pill");
    if (!nav || !marker) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const measure = (): number | null => {
      const target = nav.querySelector<HTMLElement>('.shell-item[data-active="true"], .shell-subitem[data-active="true"]');
      if (!target || target.offsetParent === null) return null;
      const navRect = nav.getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      return rect.top - navRect.top + nav.scrollTop + rect.height / 2 - marker.offsetHeight / 2;
    };

    const first = measure();
    if (first === null) {
      gsap.to(marker, { autoAlpha: 0, duration: reduced ? 0 : 0.2 });
      return;
    }
    const hidden = gsap.getProperty(marker, "opacity") === 0;
    if (hidden) gsap.set(marker, { y: first, autoAlpha: 1 });

    const moveTo = gsap.quickTo(marker, "y", { duration: reduced ? 0 : 0.45, ease: "power3.out" });
    moveTo(first);
    gsap.set(marker, { autoAlpha: 1 });

    const followFor = reduced ? 0 : 450;
    const startedAt = performance.now();
    const follow = () => {
      const y = measure();
      if (y !== null) moveTo(y);
      if (performance.now() - startedAt > followFor) gsap.ticker.remove(follow);
    };
    gsap.ticker.add(follow);
    return () => gsap.ticker.remove(follow);
  }, [activeKey]);
}
