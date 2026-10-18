"use client";

import type { CSSProperties, ReactNode } from "react";
import { BlockStack, Card, InlineStack, Layout, SkeletonPage } from "@shopify/polaris";

/**
 * Loading screens that look like the page they stand in for — a list shows a toolbar and table
 * rows, a detail page shows its main column and side column, a tool shows its steps and drop
 * zone — instead of one generic placeholder for every route. Each route's `loading.tsx` picks
 * the one that matches its page. They use the app's glass cards and a soft shimmer, and carry
 * `data-skeleton` so the page fades in when the real content replaces them (see PageMotion).
 */

type Size = string | number;

function Sk({ w = "100%", h = "0.75rem", r, className = "" }: { w?: Size; h?: Size; r?: Size; className?: string }) {
  const style: CSSProperties = { width: w, height: h, borderRadius: r ?? 999, flex: "none" };
  return <span className={`sk ${className}`.trim()} style={style} aria-hidden="true" />;
}

/** A few text-line placeholders; the last is shorter, like real wrapped text. */
function SkLines({ count = 3, gap = "0.625rem" }: { count?: number; gap?: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap, width: "100%" }} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <Sk key={i} w={i === count - 1 && count > 1 ? "62%" : "100%"} />
      ))}
    </span>
  );
}

function Frame({ children, action = true, title = true }: { children: ReactNode; action?: boolean; title?: boolean }) {
  return (
    <div data-skeleton role="status" aria-busy="true" aria-label="Loading">
      <SkeletonPage fullWidth primaryAction={action} title={title ? undefined : ""}>
        <Layout>{children}</Layout>
      </SkeletonPage>
    </div>
  );
}

function Stats({ count = 4 }: { count?: number }) {
  return (
    <div className="stat-grid">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="stat-card" style={{ minHeight: "5.75rem" }} aria-hidden="true">
          <span className="stat-card-head">
            <Sk w="1.75rem" h="1.75rem" r="0.5rem" />
            <Sk w="55%" />
          </span>
          <Sk w="38%" h="1.5rem" r="0.5rem" />
        </div>
      ))}
    </div>
  );
}

/** A table: a toolbar of filters and a search, a header row, and rows of cells. */
export function ListSkeleton({ columns = 5, rows = 8, stats = 0, thumbnail = false }: { columns?: number; rows?: number; stats?: number; thumbnail?: boolean }) {
  return (
    <Frame>
      {stats > 0 && (
        <Layout.Section>
          <Stats count={stats} />
        </Layout.Section>
      )}
      <Layout.Section>
        <Card padding="0">
          <div style={{ display: "flex", gap: "0.5rem", padding: "0.875rem 1rem", borderBottom: "1px solid var(--p-color-border)" }}>
            <Sk w="5.5rem" h="2rem" r="0.625rem" />
            <Sk w="5.5rem" h="2rem" r="0.625rem" />
            <Sk w="5.5rem" h="2rem" r="0.625rem" />
            <span style={{ flex: 1 }} />
            <Sk w="14rem" h="2rem" r="0.625rem" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `1.25rem ${thumbnail ? "2.5rem " : ""}2fr ${"1fr ".repeat(Math.max(1, columns - 2))}`, gap: "1rem", padding: "0.75rem 1rem", background: "var(--p-color-bg-surface-secondary)" }}>
            <Sk w="1rem" h="1rem" r="0.3rem" />
            {thumbnail && <span />}
            {Array.from({ length: columns - 1 }, (_, c) => (
              <Sk key={c} w={c === 0 ? "40%" : "55%"} h="0.625rem" />
            ))}
          </div>
          {Array.from({ length: rows }, (_, r) => (
            <div
              key={r}
              style={{ display: "grid", gridTemplateColumns: `1.25rem ${thumbnail ? "2.5rem " : ""}2fr ${"1fr ".repeat(Math.max(1, columns - 2))}`, gap: "1rem", alignItems: "center", padding: "0.75rem 1rem", borderTop: "1px solid var(--p-color-border)" }}
            >
              <Sk w="1rem" h="1rem" r="0.3rem" />
              {thumbnail && <Sk w="2.5rem" h="2.5rem" r="0.5rem" />}
              {Array.from({ length: columns - 1 }, (_, c) => (
                <Sk key={c} w={c === 0 ? `${62 + ((r * 7) % 30)}%` : `${48 + ((r * 11 + c * 5) % 36)}%`} />
              ))}
            </div>
          ))}
        </Card>
      </Layout.Section>
    </Frame>
  );
}

/** A record: a wide main column of cards and a narrower side column. */
export function DetailSkeleton() {
  return (
    <Frame>
      <Layout.Section>
        <BlockStack gap="400">
          <Card>
            <BlockStack gap="300">
              <Sk w="9rem" h="1.25rem" r="0.5rem" />
              <SkLines count={4} />
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="300">
              <Sk w="7rem" h="1.25rem" r="0.5rem" />
              <InlineStack gap="300">
                {[0, 1, 2, 3].map((i) => (
                  <Sk key={i} w="5.5rem" h="5.5rem" r="0.75rem" />
                ))}
              </InlineStack>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="300">
              <Sk w="8rem" h="1.25rem" r="0.5rem" />
              <SkLines count={3} />
              <SkLines count={2} />
            </BlockStack>
          </Card>
        </BlockStack>
      </Layout.Section>
      <Layout.Section variant="oneThird">
        <BlockStack gap="400">
          <Card>
            <BlockStack gap="300">
              <Sk w="6rem" h="1.25rem" r="0.5rem" />
              <Sk w="5.5rem" h="1.75rem" r="0.5rem" />
              <SkLines count={2} />
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="300">
              <Sk w="7rem" h="1.25rem" r="0.5rem" />
              <SkLines count={3} />
            </BlockStack>
          </Card>
        </BlockStack>
      </Layout.Section>
    </Frame>
  );
}

/** A form: stacked cards, each a heading and a few labelled fields. */
export function FormSkeleton({ cards = 2, fields = 3 }: { cards?: number; fields?: number }) {
  return (
    <Frame>
      <Layout.Section>
        <BlockStack gap="400">
          {Array.from({ length: cards }, (_, c) => (
            <Card key={c}>
              <BlockStack gap="400">
                <Sk w="10rem" h="1.25rem" r="0.5rem" />
                {Array.from({ length: fields }, (_, f) => (
                  <BlockStack key={f} gap="150">
                    <Sk w="6rem" h="0.75rem" />
                    <Sk h="2.25rem" r="0.75rem" />
                  </BlockStack>
                ))}
              </BlockStack>
            </Card>
          ))}
        </BlockStack>
      </Layout.Section>
    </Frame>
  );
}

/** A tool: its step badges, a drop zone for the input file, then an options card with a primary button. */
export function ToolSkeleton() {
  return (
    <Frame action={false}>
      <Layout.Section>
        <BlockStack gap="400">
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <Sk w="3rem" h="3rem" r="0.875rem" />
                  <BlockStack gap="150">
                    <Sk w="13rem" h="1.5rem" r="0.5rem" />
                    <Sk w="22rem" h="0.75rem" />
                  </BlockStack>
                </InlineStack>
                <Sk w="8rem" h="1.75rem" r="0.75rem" />
              </InlineStack>
              <InlineStack gap="200">
                {[0, 1, 2].map((i) => (
                  <Sk key={i} w="8.5rem" h="1.75rem" r="0.75rem" />
                ))}
              </InlineStack>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="400">
              <Sk w="12rem" h="1.125rem" r="0.5rem" />
              <div style={{ display: "grid", placeItems: "center", gap: "0.625rem", height: "8.5rem", border: "1.5px dashed var(--p-color-border)", borderRadius: "1rem" }}>
                <Sk w="6rem" h="2rem" r="0.75rem" />
                <Sk w="9rem" h="0.625rem" />
              </div>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="400">
              <Sk w="9rem" h="1.125rem" r="0.5rem" />
              <div className="stat-grid">
                {[0, 1].map((i) => (
                  <BlockStack key={i} gap="150">
                    <Sk w="5rem" h="0.75rem" />
                    <Sk h="2.25rem" r="0.75rem" />
                  </BlockStack>
                ))}
              </div>
              <Sk w="9rem" h="2.5rem" r="0.75rem" />
            </BlockStack>
          </Card>
        </BlockStack>
      </Layout.Section>
    </Frame>
  );
}

/** A hub of link tiles (like Content). */
export function HubSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <Frame action={false}>
      <Layout.Section>
        <div className="bento">
          {Array.from({ length: tiles }, (_, i) => (
            <div key={i} className="bento-tile bento-span-6" aria-hidden="true">
              <Sk w="2.5rem" h="2.5rem" r="0.75rem" />
              <Sk w="8rem" h="1rem" r="0.5rem" />
              <SkLines count={2} />
            </div>
          ))}
        </div>
      </Layout.Section>
    </Frame>
  );
}

/** A grid of image cards (Files). */
export function GridSkeleton({ items = 12 }: { items?: number }) {
  return (
    <Frame>
      <Layout.Section>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(11rem, 1fr))", gap: "0.875rem" }}>
          {Array.from({ length: items }, (_, i) => (
            <div key={i} className="bento-tile" style={{ padding: "0.75rem" }} aria-hidden="true">
              <Sk h="7.5rem" r="0.75rem" />
              <Sk w="75%" />
              <Sk w="40%" h="0.625rem" />
            </div>
          ))}
        </div>
      </Layout.Section>
    </Frame>
  );
}

/** The Home dashboard: greeting hero beside a stat, three more stats, launcher tiles, then two cards. */
export function HomeSkeleton() {
  return (
    <div data-skeleton role="status" aria-busy="true" aria-label="Loading" style={{ padding: "1rem 1.25rem" }}>
      <BlockStack gap="400">
        <div className="bento">
          <div className="bento-tile bento-hero bento-span-8" style={{ minHeight: "11rem", justifyContent: "space-between" }} aria-hidden="true">
            <BlockStack gap="300">
              <Sk w="7rem" h="0.75rem" />
              <Sk w="70%" h="2rem" r="0.5rem" />
              <Sk w="45%" h="2rem" r="0.5rem" />
            </BlockStack>
            <InlineStack gap="200">
              <Sk w="9rem" h="2.25rem" r="0.75rem" />
              <Sk w="8rem" h="2.25rem" r="0.75rem" />
            </InlineStack>
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bento-tile bento-span-4" aria-hidden="true">
              <Sk w="2.5rem" h="2.5rem" r="0.75rem" />
              <Sk w="40%" h="1.75rem" r="0.5rem" />
              <Sk w="60%" h="0.75rem" />
            </div>
          ))}
        </div>
        <div className="bento">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="bento-tile bento-span-4" aria-hidden="true">
              <Sk w="2.5rem" h="2.5rem" r="0.75rem" />
              <Sk w="55%" h="1rem" r="0.5rem" />
              <SkLines count={2} />
            </div>
          ))}
        </div>
      </BlockStack>
    </div>
  );
}

/** Analytics: a row of stat tiles and two chart cards. */
export function AnalyticsSkeleton() {
  return (
    <Frame action={false}>
      <Layout.Section>
        <Stats count={4} />
      </Layout.Section>
      <Layout.Section>
        <Card>
          <BlockStack gap="300">
            <Sk w="10rem" h="1.25rem" r="0.5rem" />
            <Sk h="13rem" r="0.875rem" />
          </BlockStack>
        </Card>
      </Layout.Section>
    </Frame>
  );
}
