"use client";

import { Box, BlockStack, Text, Button, InlineStack } from "@shopify/polaris";

export default function NotFound() {
  return (
    <Box background="bg-surface-secondary" minHeight="100vh" padding="800">
      <div style={{ maxWidth: "30rem", margin: "12vh auto 0", textAlign: "center" }}>
        <BlockStack gap="400" inlineAlign="center">
          <Text as="p" variant="heading3xl" tone="subdued">
            404
          </Text>
          <Text as="h1" variant="headingLg">
            We couldn&apos;t find that page
          </Text>
          <Text as="p" tone="subdued">
            The link may be out of date, or the page may have moved.
          </Text>
          <InlineStack gap="200">
            <Button variant="primary" url="/home">
              Go to dashboard
            </Button>
            <Button url="/products">Products</Button>
          </InlineStack>
        </BlockStack>
      </div>
    </Box>
  );
}
