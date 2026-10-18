"use client";

import { AppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import NextLink from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { ThemeModeProvider, useThemeMode } from "@/components/theme/ThemeContext";

interface LinkLikeProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  url: string;
  children?: ReactNode;
  external?: boolean;
}

function RouterLink({ url, children, external, ...rest }: LinkLikeProps) {
  if (external) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  return (
    <NextLink href={url} {...rest}>
      {children}
    </NextLink>
  );
}

function ThemedAppProvider({ children }: { children: ReactNode }) {
  const { resolved } = useThemeMode();
  return (
    <AppProvider
      i18n={enTranslations}
      linkComponent={RouterLink}
      theme={resolved === "dark" ? "dark-experimental" : "light"}
    >
      {children}
    </AppProvider>
  );
}

export function PolarisProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeModeProvider>
      <ThemedAppProvider>{children}</ThemedAppProvider>
    </ThemeModeProvider>
  );
}
