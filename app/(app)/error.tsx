"use client";

import { Page, Layout, Card, BlockStack, InlineStack, Text, Button, Banner } from "@shopify/polaris";

/**
 * Segment error boundary. Next 16 passes `retry` (not `reset`) — re-running
 * the segment is usually enough, since most failures here are a transient
 * Shopify API error rather than a broken render.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <Page title="Something went wrong">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Banner tone="critical" title="This page couldn't load">
                <p>{error.message || "An unexpected error occurred while loading this page."}</p>
              </Banner>

              <Text as="p" tone="subdued">
                This is usually a temporary Shopify API error or an expired access token. Try again — if
                it keeps failing, reconnect the store from Store connection.
              </Text>

              <InlineStack gap="200">
                <Button variant="primary" onClick={retry}>
                  Try again
                </Button>
                <Button url="/settings/connection">Store connection</Button>
              </InlineStack>

              {error.digest && (
                <Text as="p" tone="subdued" variant="bodySm">
                  Reference: {error.digest}
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
