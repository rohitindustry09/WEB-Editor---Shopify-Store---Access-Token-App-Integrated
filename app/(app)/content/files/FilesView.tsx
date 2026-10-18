"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Page, Layout, Card, InlineGrid, Thumbnail, Text, InlineStack, Box } from "@shopify/polaris";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { ResourceEmptyState } from "@/components/ui/ResourceEmptyState";
import { MediaPicker } from "@/components/ui/MediaPicker";
import type { StoreFile } from "@/lib/shopify/files";

export function FilesView({ files, error }: { files: StoreFile[]; error: string | null }) {
  const router = useRouter();
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <Page fullWidth title="Files" backAction={{ content: "Content", url: "/content" }} primaryAction={{ content: "Upload files", onAction: () => setUploadOpen(true) }}>
      <Layout>
        {error && (
          <Layout.Section>
            <ApiErrorBanner error={error} />
          </Layout.Section>
        )}
        <Layout.Section>
          {!error && files.length === 0 ? (
            <ResourceEmptyState heading="No files yet" action={{ content: "Upload files", onAction: () => setUploadOpen(true) }}>
              <p>Images you upload will show up here and become available across the editor.</p>
            </ResourceEmptyState>
          ) : (
            <Card>
              <BlockGrid files={files} />
            </Card>
          )}
        </Layout.Section>
      </Layout>

      <MediaPicker
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSelect={() => router.refresh()}
      />
    </Page>
  );
}

function BlockGrid({ files }: { files: StoreFile[] }) {
  return (
    <InlineGrid columns={{ xs: 2, sm: 3, md: 4, lg: 6 }} gap="300">
      {files.map((f) => (
        <Box key={f.id}>
          <InlineStack gap="150" blockAlign="center" align="center">
            {f.url ? <Thumbnail source={f.url} alt={f.alt ?? ""} size="large" /> : <Text as="span" tone="subdued" variant="bodySm">Processing…</Text>}
          </InlineStack>
          {f.alt && (
            <Text as="p" variant="bodySm" tone="subdued" truncate>{f.alt}</Text>
          )}
        </Box>
      ))}
    </InlineGrid>
  );
}
