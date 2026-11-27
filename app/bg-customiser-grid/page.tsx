import { BgCustomiserGridPage } from "./BgCustomiserGridPage";

/**
 * Deliberately OUTSIDE the `(app)` route group, same reasoning as
 * `store-scraper-preview/[id]`: a bare, single-purpose page with no
 * dashboard chrome. There's no job id and no server data to load here — the
 * zip this page needs to read only ever exists in whichever tab opened this
 * one, reached live via `window.opener` (see `gridBridge.ts`). It belongs to
 * the Background customiser, which is free to use, so there is no login gate.
 */
export default function BgCustomiserGridRoute() {
  return <BgCustomiserGridPage />;
}
