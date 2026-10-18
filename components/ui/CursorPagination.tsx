"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { InlineStack, Pagination, Text } from "@shopify/polaris";

interface CursorPaginationProps {
  page: number;
  pageSize: number;
  count: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

export function CursorPagination({
  page,
  pageSize,
  count,
  hasNextPage,
  hasPreviousPage,
  startCursor,
  endCursor,
}: CursorPaginationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rangeStart = count === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = (page - 1) * pageSize + count;

  const goTo = (cursor: string | null, direction: "next" | "prev") => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("after");
    params.delete("before");
    if (direction === "next" && cursor) {
      params.set("after", cursor);
      params.set("page", String(page + 1));
    } else if (direction === "prev" && cursor) {
      params.set("before", cursor);
      params.set("page", String(Math.max(1, page - 1)));
    } else {
      params.delete("page");
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  if (!hasNextPage && !hasPreviousPage) return null;

  return (
    <InlineStack align="space-between" blockAlign="center">
      <Text as="span" tone="subdued" variant="bodySm">
        {count === 0 ? "No results" : `${rangeStart}–${rangeEnd}`}
      </Text>
      <Pagination
        hasPrevious={hasPreviousPage}
        onPrevious={() => goTo(startCursor, "prev")}
        hasNext={hasNextPage}
        onNext={() => goTo(endCursor, "next")}
      />
    </InlineStack>
  );
}
