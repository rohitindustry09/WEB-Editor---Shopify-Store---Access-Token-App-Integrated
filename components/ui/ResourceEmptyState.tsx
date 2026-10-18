"use client";

import { EmptyState } from "@shopify/polaris";
import type { ReactNode } from "react";

const DEFAULT_IMAGE =
  "https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg";

interface ResourceEmptyStateProps {
  heading: string;
  children?: ReactNode;
  action?: { content: string; url?: string; onAction?: () => void };
}

export function ResourceEmptyState({ heading, children, action }: ResourceEmptyStateProps) {
  return (
    <EmptyState heading={heading} image={DEFAULT_IMAGE} action={action}>
      {children}
    </EmptyState>
  );
}
