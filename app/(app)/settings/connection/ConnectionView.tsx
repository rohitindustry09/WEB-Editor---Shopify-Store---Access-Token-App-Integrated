"use client";

import { Page, Layout, BlockStack } from "@shopify/polaris";
import { ConnectionCard } from "@/components/settings/ConnectionCard";

export function ConnectionView({ domain, scopes, grantedScopes }: { domain: string; scopes: string[]; grantedScopes: string[] | null }) {
  return (
    <Page fullWidth title="Store connection" backAction={{ content: "Home", url: "/home" }}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <ConnectionCard domain={domain} scopes={scopes} grantedScopes={grantedScopes} />
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
