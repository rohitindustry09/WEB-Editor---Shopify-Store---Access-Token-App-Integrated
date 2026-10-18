"use client";

import { useRouter } from "next/navigation";
import { Card, BlockStack, InlineStack, Text, Checkbox, Button, Badge, Box } from "@shopify/polaris";
import { useOnboarding } from "@/components/onboarding/OnboardingContext";
import { capabilities } from "@/lib/scopes";

const ICONS: Record<string, string> = {
  products: "🪔",
  collections: "🗂️",
  inventory: "📦",
  orders: "🧾",
  customers: "👥",
  discounts: "🏷️",
  content: "📝",
};

export default function PermissionsPage() {
  const router = useRouter();
  const { capabilityIds, toggleCapability } = useOnboarding();

  return (
    <BlockStack gap="400">
      <BlockStack gap="150">
        <Text as="h1" variant="headingLg">What should the editor be able to do?</Text>
        <Text as="p" tone="subdued">
          Only the capabilities you select here will be requested as permissions on your Shopify store.
        </Text>
      </BlockStack>

      <BlockStack gap="200">
        {capabilities.map((cap) => {
          const checked = capabilityIds.includes(cap.id);
          return (
            <Card key={cap.id} background={checked ? "bg-surface-secondary" : undefined}>
              <InlineStack gap="300" blockAlign="start" wrap={false}>
                <Text as="span" variant="headingMd">{ICONS[cap.id]}</Text>
                <Box width="100%">
                  <BlockStack gap="050">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" fontWeight="semibold">{cap.label}</Text>
                      {cap.required && <Badge tone="critical">Required</Badge>}
                    </InlineStack>
                    <Text as="span" tone="subdued" variant="bodySm">{cap.description}</Text>
                  </BlockStack>
                </Box>
                <Checkbox
                  label=""
                  labelHidden
                  checked={checked}
                  disabled={cap.required}
                  onChange={() => toggleCapability(cap.id)}
                />
              </InlineStack>
            </Card>
          );
        })}
      </BlockStack>

      <InlineStack align="space-between" blockAlign="center">
        <Text as="span" tone="subdued" variant="bodySm">
          {capabilityIds.length} of {capabilities.length} selected
        </Text>
        <InlineStack gap="200">
          <Button onClick={() => router.push("/connect")}>Back</Button>
          <Button variant="primary" onClick={() => router.push("/connect/instructions")}>Continue</Button>
        </InlineStack>
      </InlineStack>
    </BlockStack>
  );
}
