"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Box, BlockStack, InlineStack, Text, TextField, Badge, Icon } from "@shopify/polaris";
import { ChevronRightIcon, StoreIcon } from "@shopify/polaris-icons";
import { useOnboarding } from "@/components/onboarding/OnboardingContext";

const VALID_STORE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const GREEN = "var(--wz-green)";
const GREEN_DARK = "var(--wz-green-ink)";
const GREEN_TINT = "var(--wz-tint)";
/** The Continue button is a dark fill with white text in both themes. */
const GREEN_SOLID = "#004c3f";

export default function ConnectStorePage() {
  const router = useRouter();
  const { storeName, setStoreName } = useOnboarding();
  const [touched, setTouched] = useState(false);

  const isValid = useMemo(
    () => storeName.length >= 3 && VALID_STORE.test(storeName),
    [storeName],
  );

  return (
    <BlockStack gap="500" inlineAlign="center">
      <BlockStack gap="150" inlineAlign="center">
        <Text as="h1" variant="headingLg" alignment="center">What&apos;s your store&apos;s address?</Text>
        <Text as="p" tone="subdued" alignment="center">
          Enter the part before .myshopify.com — you&apos;ll find it in your Shopify admin URL.
        </Text>
      </BlockStack>

      <div style={{ width: "100%" }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (isValid) router.push("/connect/permissions");
          }}
        >
          <BlockStack gap="0">
            <Box
              padding="400"
              borderWidth="025"
              borderColor="border"
              borderRadius="300"
            >
              <BlockStack gap="300">
                <TextField
                  label="Store name"
                  autoComplete="off"
                  value={storeName}
                  onChange={(v) => setStoreName(v.toLowerCase().trim())}
                  onBlur={() => setTouched(true)}
                  placeholder="your-store-name"
                  suffix=".myshopify.com"
                  autoFocus
                  error={touched && !isValid ? "Use lowercase letters, numbers, and hyphens — at least 3 characters." : undefined}
                />
                {isValid && (
                  <InlineStack>
                    <Badge tone="success">{`✓ ${storeName}.myshopify.com`}</Badge>
                  </InlineStack>
                )}
              </BlockStack>
            </Box>

            <Box paddingBlockStart="400">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "1rem",
                  flexWrap: "wrap",
                  background: GREEN_TINT,
                  borderRadius: 12,
                  padding: "0.85rem 1rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.35rem",
                      background: "var(--p-color-bg-surface)",
                      borderRadius: 8,
                      padding: "0.35rem 0.6rem",
                      fontSize: 12,
                      color: "var(--p-color-text-secondary)",
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ color: GREEN }}>
                      <Icon source={StoreIcon} />
                    </span>
                    <span>
                      admin.shopify.com/store/
                      <span style={{ color: GREEN_DARK, fontWeight: 600 }}>{storeName || "your-store"}</span>
                    </span>
                  </div>
                </div>
                <BlockStack gap="0">
                  <Text as="span" variant="bodySm" fontWeight="medium">
                    You&apos;ll find this in your Shopify admin URL
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Example: admin.shopify.com/store/your-store
                  </Text>
                </BlockStack>
                <button
                  type="submit"
                  disabled={!isValid}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    background: isValid ? GREEN_SOLID : "var(--p-color-bg-disabled)",
                    color: isValid ? "#fff" : "var(--p-color-text-disabled)",
                    border: "none",
                    borderRadius: 10,
                    padding: "0.6rem 1.1rem",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: isValid ? "pointer" : "not-allowed",
                    flexShrink: 0,
                  }}
                >
                  Continue
                  <Icon source={ChevronRightIcon} tone="inherit" />
                </button>
              </div>
            </Box>
          </BlockStack>
        </form>
      </div>
    </BlockStack>
  );
}
