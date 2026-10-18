"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Banner } from "@shopify/polaris";
import { useErrorCenter } from "@/components/errors/ErrorCenter";
import { ErrorDetails } from "@/components/errors/ErrorDetails";

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** "/products/media-upload" → "Media upload" — the page name shown in the error list. */
function sourceLabel(pathname: string): string {
  const last = pathname.split("/").filter(Boolean).pop() ?? "Home";
  const words = last.replace(/[-_]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Reports a Shopify error to the "i" button in the top-right corner instead of drawing a banner
 * in the page: the error (with the access scopes it needs, and the steps to add them) is listed
 * there, and the page stays clean. Outside the app shell there is no "i" button, so the error is
 * shown inline as before.
 */
export function ApiErrorBanner({ error }: { error: string }) {
  const center = useErrorCenter();
  const pathname = usePathname();
  const report = center?.report;
  const clear = center?.clear;
  const id = `${pathname}::${hash(error)}`;

  useEffect(() => {
    if (!report || !clear) return;
    report({ id, error, source: sourceLabel(pathname) });
    return () => clear(id);
  }, [report, clear, id, error, pathname]);

  if (center) return null;
  return (
    <Banner tone="critical">
      <ErrorDetails error={error} />
    </Banner>
  );
}
