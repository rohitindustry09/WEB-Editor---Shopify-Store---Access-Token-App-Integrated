"use client";

import "./errors.css";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Badge, Button, Icon, Text } from "@shopify/polaris";
import { InfoIcon, XIcon } from "@shopify/polaris-icons";
import { gsap, useGSAP, MOTION_OK } from "@/lib/motion/gsap";
import { useErrorCenter, type ReportedError } from "./ErrorCenter";
import { ErrorDetails } from "./ErrorDetails";

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

const OPEN_TIMELINE = "err-panel-open";

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The wide error panel: it unrolls from the "i" button in the top-right corner (GSAP), lists every
 * error the pages have reported with the full explanation, and closes with Esc, the backdrop or the
 * close button. Focus moves into it while open, stays inside, and returns to the button after.
 */
function ErrorPopup({
  errors,
  onDismiss,
  onDismissAll,
  onClose,
}: {
  errors: ReportedError[];
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  const { contextSafe } = useGSAP(
    () => {
      const panel = root.current?.querySelector<HTMLElement>(".err-panel");
      if (!panel) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        // The panel grows out of the "i" button: first a thin strip widens from the right edge (width 0 to full),
        // then it opens downward. clip-path is cheap to animate (no layout, nothing re-blurred), and the
        // sizes are measured once so the tween is plain numbers.
        const width = panel.offsetWidth;
        const height = panel.offsetHeight;
        const strip = Math.min(64, height);
        const tl = gsap.timeline({ id: OPEN_TIMELINE });
        tl.fromTo(".err-backdrop", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3, ease: "power1.out" }, 0)
          .fromTo(
            panel,
            { clipPath: `inset(0px 0px ${height - strip}px ${width}px round 24px)` },
            { clipPath: `inset(0px 0px ${height - strip}px 0px round 24px)`, duration: 0.5, ease: "power3.inOut" },
            0.04,
          )
          .to(panel, { clipPath: "inset(0px 0px 0px 0px round 24px)", duration: 0.5, ease: "power3.out" }, ">-0.08")
          .from(".err-item", { y: 12, autoAlpha: 0, duration: 0.4, stagger: 0.06, ease: "power3.out" }, "<0.12");
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  const close = contextSafe(() => {
    // Looked up by id (not kept in a ref) so closing always reaches the timeline that opened this panel.
    const tl = gsap.getById(OPEN_TIMELINE) as gsap.core.Timeline | undefined;
    if (!tl || prefersReducedMotion()) return onClose();
    // Play the same timeline backwards a little faster: the panel folds away the way it opened.
    tl.eventCallback("onReverseComplete", onClose).timeScale(1.7).reverse();
  });

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    // Keep Tab inside the panel while it is open.
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>(`.err-panel ${FOCUSABLE.split(", ").join(`, .err-panel `)}`) ?? []);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="err-layer" ref={root} onKeyDown={onKeyDown}>
      <button type="button" className="err-backdrop" aria-label="Close the error list" onClick={close} tabIndex={-1} />
      <section className="err-panel" role="dialog" aria-modal="true" aria-labelledby="err-title">
        <header className="err-head">
          <div className="err-head-title">
            <Text as="h2" variant="headingMd">
              <span id="err-title">Errors</span>
            </Text>
            {errors.length > 0 && <Badge tone="critical">{String(errors.length)}</Badge>}
          </div>
          <div className="err-head-actions">
            {errors.length > 0 && (
              <Button variant="tertiary" onClick={onDismissAll}>
                Dismiss all
              </Button>
            )}
            <button type="button" className="err-close" ref={closeButton} onClick={close} aria-label="Close">
              <Icon source={XIcon} tone="inherit" />
            </button>
          </div>
        </header>

        <div className="err-list">
          {errors.length === 0 ? (
            <div className="err-empty">
              <Text as="p" tone="subdued">
                No errors right now. If something can&apos;t be loaded from Shopify, it shows up here with what to do about it.
              </Text>
            </div>
          ) : (
            errors.map((entry) => (
              <article key={entry.id} className="err-item">
                <div className="err-item-head">
                  <Badge tone="critical">{entry.source}</Badge>
                  <span className="err-item-time">{new Date(entry.at).toLocaleTimeString()}</span>
                  <span className="err-spacer" />
                  <Button variant="tertiary" size="slim" onClick={() => onDismiss(entry.id)}>
                    Dismiss
                  </Button>
                </div>
                <ErrorDetails error={entry.error} />
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

/** The fixed "i" button (top-right) and, when opened, the error panel. It shows a red count when errors are waiting. */
export function ErrorPanel() {
  const center = useErrorCenter();
  const [open, setOpen] = useState(false);
  const fab = useRef<HTMLButtonElement>(null);
  const seen = useRef(0);
  const count = center?.errors.length ?? 0;

  // The button gives a small bounce when a new error arrives, so it is noticed without opening anything.
  useEffect(() => {
    if (count > seen.current && fab.current && !prefersReducedMotion()) {
      gsap.fromTo(fab.current, { scale: 1 }, { scale: 1.3, duration: 0.18, yoyo: true, repeat: 1, ease: "power2.out" });
    }
    seen.current = count;
  }, [count]);

  if (!center) return null;

  return (
    <>
      <button
        type="button"
        ref={fab}
        className="err-fab"
        data-has-errors={count > 0}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={count > 0 ? `Errors (${count}) — open the list` : "Errors — none right now"}
        onClick={() => setOpen(true)}
      >
        <Icon source={InfoIcon} tone="inherit" />
        {count > 0 && <span className="err-fab-badge">{count}</span>}
      </button>
      <span className="visually-hidden" role="status" aria-live="polite">
        {count > 0 ? `${count} error${count === 1 ? "" : "s"} — open the information button in the top right to read ${count === 1 ? "it" : "them"}.` : ""}
      </span>
      {open && (
        <ErrorPopup
          errors={center.errors}
          onDismiss={center.dismiss}
          onDismissAll={center.dismissAll}
          onClose={() => {
            setOpen(false);
            fab.current?.focus();
          }}
        />
      )}
    </>
  );
}
