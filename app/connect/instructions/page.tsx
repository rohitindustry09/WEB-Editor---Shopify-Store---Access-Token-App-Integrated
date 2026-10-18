"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, BlockStack, InlineStack, Text, Button, Box } from "@shopify/polaris";
import { useOnboarding } from "@/components/onboarding/OnboardingContext";
import { scopesFor } from "@/lib/scopes";

export default function InstructionsPage() {
  const router = useRouter();
  const { storeName, capabilityIds } = useOnboarding();
  const [copied, setCopied] = useState(false);

  const scopes = scopesFor(capabilityIds);
  const adminUrl = storeName
    ? `https://${storeName}.myshopify.com/admin/settings/apps/development`
    : "#";

  const copyScopes = async () => {
    try {
      await navigator.clipboard.writeText(scopes.join(", "));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard unavailable — no-op
    }
  };

  const steps = [
    <span key="1">In Shopify admin, go to <b>Settings → Apps and sales channels → Develop apps</b>.</span>,
    <span key="2">Click <b>Create an app</b> and name it <b>Brasstown Editor</b>.</span>,
    <span key="3">Open the <b>Configuration</b> tab and select <b>Admin API integration</b>.</span>,
    <span key="4">Enable exactly the scopes listed below, then save.</span>,
    <span key="5">Go to the <b>API credentials</b> tab and click <b>Install app</b>.</span>,
  ];

  return (
    <BlockStack gap="400">
      <BlockStack gap="150">
        <Text as="h1" variant="headingLg">Create a custom app in Shopify</Text>
        <Text as="p" tone="subdued">
          This takes about a minute. It generates the access token we&apos;ll ask for next — scoped to only what you selected.
        </Text>
      </BlockStack>

      <Card>
        <BlockStack gap="300">
          {steps.map((step, i) => (
            <InlineStack key={i} gap="300" blockAlign="start" wrap={false}>
              <Box
                minWidth="24px"
                background="bg-surface-secondary"
                borderRadius="full"
              >
                <Box padding="050">
                  <Text as="span" alignment="center" variant="bodySm" fontWeight="semibold">{i + 1}</Text>
                </Box>
              </Box>
              <Text as="p">{step}</Text>
            </InlineStack>
          ))}
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
              Admin API scopes to enable
            </Text>
            <Button variant="plain" onClick={copyScopes}>{copied ? "Copied ✓" : "Copy all"}</Button>
          </InlineStack>
          <InlineStack gap="150" wrap>
            {scopes.map((scope) => (
              <Box key={scope} background="bg-surface-secondary" padding="100" borderRadius="150">
                <Text as="span" variant="bodySm" fontWeight="medium">{scope}</Text>
              </Box>
            ))}
          </InlineStack>
        </BlockStack>
      </Card>

      <Button url={adminUrl} target="_blank" fullWidth>
        Open Shopify admin ↗
      </Button>

      <InlineStack align="space-between">
        <Button onClick={() => router.push("/connect/permissions")}>Back</Button>
        <Button variant="primary" onClick={() => router.push("/connect/token")}>I&apos;ve created the app</Button>
      </InlineStack>
    </BlockStack>
  );
}
