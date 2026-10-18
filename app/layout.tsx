import type { Metadata } from "next";
import "@shopify/polaris/build/esm/styles.css";
import "./globals.css";
import "./dark-theme.css";
import "./ui.css";
import "./ui-controls.css";
import "./ui-elements.css";
import "./ui-tiles.css";
import "./ui-choices.css";
import "./ui-select.css";
import { PolarisProvider } from "@/components/PolarisProvider";
import { CursorFx } from "@/components/motion/CursorFx";
import { THEME_INIT_SCRIPT } from "@/components/theme/ThemeContext";

export const metadata: Metadata = {
  title: "Brasstown Store Editor",
  description: "A faster editor for your Shopify store.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      {/* Extensions (password managers, page-scanning security add-ons) stamp
          attributes onto <body> before React hydrates, which otherwise logs a
          hydration mismatch on every load. Scoped to this element only, so a
          real mismatch anywhere else still surfaces. */}
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        <PolarisProvider>{children}</PolarisProvider>
        <CursorFx />
      </body>
    </html>
  );
}
