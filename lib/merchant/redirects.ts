/** Checks a list of redirects against the store's existing ones: duplicates, loops, chains, conflicts. Pure functions. */

export interface Redirect {
  path: string;
  target: string;
}

export type RedirectStatus = "ok" | "flattened" | "exists" | "duplicate" | "invalid" | "loop" | "self";

export interface PlannedRedirect {
  line: number;
  from: string;
  to: string;
  status: RedirectStatus;
  /** Why the row is skipped, or what was changed for it. */
  note: string;
}

const MAX_CHAIN = 25;

/** "/a/" → "/a", a full URL → its path; anything that is not a path (or URL) is null. */
export function normalizeFrom(raw: string): string | null {
  let text = raw.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      text = `${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  }
  if (!text.startsWith("/") || /\s/.test(text)) return null;
  return text.length > 1 ? text.replace(/\/+$/, "") || "/" : text;
}

/** A target is a path or an absolute http(s) URL, without spaces. */
export function normalizeTo(raw: string): string | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  if (text.startsWith("/")) return text.length > 1 ? text.replace(/\/+$/, "") || "/" : text;
  return /^https?:\/\//i.test(text) ? text : null;
}

/** Follows from → to links through `map`; returns the final target, or "loop" when it comes back around. */
export function resolveFinal(start: string, map: ReadonlyMap<string, string>): { final: string; hops: number } | "loop" {
  const seen = new Set<string>([start]);
  let current = map.get(start);
  let hops = 0;
  while (current !== undefined) {
    hops += 1;
    const next = map.get(current);
    if (next === undefined) return { final: current, hops };
    if (seen.has(current) || hops > MAX_CHAIN) return "loop";
    seen.add(current);
    current = next;
  }
  return { final: start, hops };
}

/**
 * Plans an import. Rows that already exist in the store, repeat an earlier row, point at themselves, form a
 * loop, or are malformed are skipped with a reason; rows whose target is itself redirected are rewritten to
 * the final destination (so visitors take one hop, not two).
 */
export function planRedirects(rows: { from: string; to: string }[], existing: ReadonlyArray<Redirect>): PlannedRedirect[] {
  const existingFrom = new Set(existing.map((redirect) => redirect.path));
  // Everything that redirects after the import: the store's redirects plus the new ones (first one wins per path).
  const combined = new Map<string, string>(existing.map((redirect) => [redirect.path, redirect.target]));
  const accepted = new Set<string>();
  const planned: PlannedRedirect[] = [];

  rows.forEach((raw, index) => {
    const line = index + 1;
    const from = normalizeFrom(raw.from);
    const to = normalizeTo(raw.to);
    const show = { line, from: raw.from.trim(), to: raw.to.trim() };
    if (!from) return planned.push({ ...show, status: "invalid", note: "The “from” must be a path starting with / (or a full URL on your domain)." });
    if (!to) return planned.push({ ...show, status: "invalid", note: "The “to” must be a path starting with / or a full https:// URL, with no spaces." });
    if (from === to) return planned.push({ ...show, from, to, status: "self", note: "Redirects to itself." });
    if (existingFrom.has(from)) return planned.push({ ...show, from, to, status: "exists", note: "The store already redirects this path." });
    if (accepted.has(from)) return planned.push({ ...show, from, to, status: "duplicate", note: "An earlier row already redirects this path." });
    accepted.add(from);
    combined.set(from, to);
    planned.push({ ...show, from, to, status: "ok", note: "" });
  });

  // Second pass: with every accepted row known, catch loops and shorten chains.
  return planned.map((row) => {
    if (row.status !== "ok") return row;
    const result = resolveFinal(row.from, combined);
    if (result === "loop") return { ...row, status: "loop", note: "Following the redirects leads back to where it started." };
    if (result.final === row.from) return { ...row, status: "loop", note: "Following the redirects leads back to where it started." };
    if (result.hops > 1) return { ...row, status: "flattened", to: result.final, note: `The target is itself redirected, so this goes straight to ${result.final}.` };
    return row;
  });
}

/** Existing redirects whose target is redirected again (chains) or that never end (loops). */
export function findProblems(existing: ReadonlyArray<Redirect>): { chains: Redirect[]; loops: Redirect[] } {
  const map = new Map(existing.map((redirect) => [redirect.path, redirect.target]));
  const chains: Redirect[] = [];
  const loops: Redirect[] = [];
  for (const redirect of existing) {
    const result = resolveFinal(redirect.path, map);
    if (result === "loop" || result.final === redirect.path) loops.push(redirect);
    else if (result.hops > 1) chains.push(redirect);
  }
  return { chains, loops };
}
