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

/**
 * Some security extensions (Bitdefender's TrafficLight and similar) stamp bis_skin_checked="1" on every element
 * of the page before React has hydrated it, which logs a hydration mismatch on every load. This runs first and
 * removes that one attribute as it appears — nothing else is touched, so a real mismatch still surfaces.
 */
const STRIP_EXTENSION_ATTRIBUTES = `(function(){try{var A="bis_skin_checked";function strip(n){if(n.removeAttribute)n.removeAttribute(A);var l=n.querySelectorAll?n.querySelectorAll("["+A+"]"):[];for(var i=0;i<l.length;i++)l[i].removeAttribute(A)}strip(document.documentElement);new MutationObserver(function(ms){for(var i=0;i<ms.length;i++){var m=ms[i];if(m.type==="attributes"){m.target.removeAttribute(A)}else{for(var j=0;j<m.addedNodes.length;j++){if(m.addedNodes[j].nodeType===1)strip(m.addedNodes[j])}}}}).observe(document.documentElement,{attributes:true,attributeFilter:[A],childList:true,subtree:true})}catch(e){}})();`;

export const metadata: Metadata = {
  title: "Brasstown Store Editor",
  description: "A faster editor for your Shopify store.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* One inline script (a second <script> tag makes React 19 warn); both snippets are self-contained and wrapped in their own try/catch. */}
        <script dangerouslySetInnerHTML={{ __html: `${THEME_INIT_SCRIPT}
${STRIP_EXTENSION_ATTRIBUTES}` }} />
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
