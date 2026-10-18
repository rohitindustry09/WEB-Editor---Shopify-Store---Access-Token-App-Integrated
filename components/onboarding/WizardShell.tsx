"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { Box, BlockStack, InlineStack, Text, Icon, Button } from "@shopify/polaris";
import { StoreIcon, ShieldCheckMarkIcon, StarFilledIcon } from "@shopify/polaris-icons";
import { signOutAction } from "@/app/(auth)/actions";

const STEPS = [
  { href: "/connect", label: "Name your store", detail: "Tell us which Shopify store you're connecting." },
  { href: "/connect/permissions", label: "Choose capabilities", detail: "Pick exactly what this editor is allowed to touch." },
  { href: "/connect/instructions", label: "Create the custom app", detail: "A few clicks inside Shopify admin." },
  { href: "/connect/token", label: "Paste your token", detail: "Connect it back here and you're set." },
];

// Colours come from CSS variables (defined in ui.css) so the wizard follows the light / dark theme.
const GREEN = "var(--wz-green)";
const GREEN_DARK = "var(--wz-green-ink)";
const GREEN_TINT = "var(--wz-tint)";

export function WizardShell({ children, storeName }: { children: ReactNode; storeName?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, startSignOut] = useTransition();
  const activeIndex = Math.max(
    0,
    STEPS.findIndex((step) => step.href === pathname),
  );

  const signOut = () => {
    startSignOut(async () => {
      await signOutAction();
      router.replace("/connect");
      router.refresh();
    });
  };

  return (
    <div
      className="wizard-root"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem 1.25rem",
        background: "var(--wz-bg)",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: "1.5rem",
          width: "100%",
          maxWidth: 940,
          alignItems: "stretch",
        }}
      >
        <div
          className="wizard-rail wizard-card"
          style={{
            width: 320,
            flexShrink: 0,
            display: "none",
            background: "var(--ui-glass-strong)",
            borderRadius: 20,
            boxShadow: "var(--ui-shadow-md)",
          }}
        >
          <Box padding="500">
            <BlockStack gap="500" inlineAlign="stretch">
              <InlineStack gap="300" blockAlign="center">
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    background: GREEN,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontSize: 15,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  S
                </div>
                <BlockStack gap="0">
                  <Text as="span" variant="headingSm">Brasstown Editor</Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Connect and customize your Shopify store with ease.
                  </Text>
                </BlockStack>
              </InlineStack>

              <BlockStack gap="0">
                {STEPS.map((step, i) => {
                  const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "upcoming";
                  const isLast = i === STEPS.length - 1;
                  return (
                    <div
                      key={step.href}
                      style={{
                        display: "flex",
                        gap: "0.75rem",
                        padding: "0.5rem 0.5rem",
                        borderRadius: 12,
                        background: state === "active" ? GREEN_TINT : "transparent",
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                        <div
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: "50%",
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 12,
                            fontWeight: 700,
                            background: state === "upcoming" ? "var(--p-color-bg-surface)" : GREEN,
                            color: state === "upcoming" ? "var(--p-color-text-secondary)" : "#fff",
                            border: state === "upcoming" ? "1.5px solid var(--p-color-border)" : "none",
                          }}
                        >
                          {state === "done" ? "✓" : i + 1}
                        </div>
                        {!isLast && (
                          <div
                            style={{
                              width: 2,
                              flex: 1,
                              minHeight: 28,
                              background: state === "done" ? GREEN : "var(--p-color-border)",
                              marginBlock: 2,
                            }}
                          />
                        )}
                      </div>
                      <BlockStack gap="050">
                        <Text
                          as="span"
                          variant="bodySm"
                          fontWeight="semibold"
                          tone={state === "upcoming" ? "subdued" : undefined}
                        >
                          <span style={{ color: state === "active" ? GREEN_DARK : undefined }}>{step.label}</span>
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {step.detail}
                        </Text>
                      </BlockStack>
                    </div>
                  );
                })}
              </BlockStack>

              <div
                style={{
                  display: "flex",
                  gap: "0.6rem",
                  padding: "0.85rem 0.9rem",
                  borderRadius: 12,
                  background: GREEN_TINT,
                }}
              >
                <div style={{ color: GREEN, flexShrink: 0, marginTop: 1 }}>
                  <Icon source={ShieldCheckMarkIcon} />
                </div>
                <BlockStack gap="050">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    <span style={{ color: GREEN_DARK }}>Secure &amp; private</span>
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Your data is encrypted and never shared with third parties.
                  </Text>
                </BlockStack>
              </div>
            </BlockStack>
          </Box>
        </div>

        <div
          className="wizard-card"
          style={{
            flex: 1,
            minWidth: 0,
            background: "var(--ui-glass-strong)",
            borderRadius: 20,
            boxShadow: "var(--ui-shadow-md)",
            padding: "2.5rem 2.5rem 2rem",
          }}
        >
          <BlockStack gap="600">
            <BlockStack gap="300" inlineAlign="center">
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <span style={{ color: "#f4b942" }}>
                  <Icon source={StarFilledIcon} />
                </span>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    background: GREEN_TINT,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: GREEN,
                  }}
                >
                  <Icon source={StoreIcon} />
                </div>
                <span style={{ color: "#f4b942" }}>
                  <Icon source={StarFilledIcon} />
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", width: "100%", maxWidth: 220 }}>
                <div style={{ flex: 1, height: 1, background: "var(--p-color-border)" }} />
                <Text as="span" variant="bodySm" tone="subdued">
                  Step {activeIndex + 1} of {STEPS.length}
                </Text>
                <div style={{ flex: 1, height: 1, background: "var(--p-color-border)" }} />
              </div>
            </BlockStack>

            {children}

            {storeName && (
              <InlineStack align="center" blockAlign="center" gap="150">
                <Text as="span" variant="bodySm" tone="subdued">
                  Signed in as {storeName}
                </Text>
                <Button variant="plain" onClick={signOut} loading={signingOut}>
                  Sign out
                </Button>
              </InlineStack>
            )}
          </BlockStack>
        </div>
      </div>

      <style>{`
        @media (min-width: 1024px) {
          .wizard-rail { display: block !important; }
        }
      `}</style>
    </div>
  );
}
