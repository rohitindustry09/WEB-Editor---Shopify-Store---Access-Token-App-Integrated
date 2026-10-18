"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, BlockStack, InlineStack, Text, Badge, Button, List, Banner } from "@shopify/polaris";
import { capabilities } from "@/lib/scopes";
import { ALL_SCOPES, SCOPE_INFO } from "@/lib/scopeInfo";
import { appsAdminUrl } from "@/lib/apiErrors";
import { AccessNeeded, ScopeChip } from "@/components/ui/AccessNeeded";

export function ConnectionCard({ domain, scopes, grantedScopes }: { domain: string; scopes: string[]; grantedScopes: string[] | null }) {
  const router = useRouter();
  const [disconnecting, setDisconnecting] = useState(false);

  const disconnect = async () => {
    setDisconnecting(true);
    await fetch("/api/disconnect", { method: "POST" });
    router.push("/connect");
  };

  // The token's real access when Shopify could be asked; otherwise what was chosen when connecting.
  const have = new Set(grantedScopes ?? scopes);
  const missing = ALL_SCOPES.filter((scope) => !have.has(scope));
  const groups = [...new Set(ALL_SCOPES.map((scope) => SCOPE_INFO[scope].group))];

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="050">
              <Text as="p" tone="subdued" variant="bodySm">Connected store</Text>
              <Text as="h2" variant="headingMd">{domain || "Not connected"}</Text>
            </BlockStack>
            <Badge tone="success">Connected</Badge>
          </InlineStack>
          <InlineStack gap="400">
            <Button url="/connect/token">Reconnect</Button>
            <Button tone="critical" loading={disconnecting} onClick={disconnect}>
              Disconnect
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <BlockStack gap="050">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h3" variant="headingSm">Access scopes</Text>
              <Badge tone={missing.length === 0 ? "success" : "attention"}>{missing.length === 0 ? "All granted" : `${missing.length} to add`}</Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {grantedScopes ? "Read from Shopify just now." : "Shopify could not be asked, so this shows what was chosen when you connected."} The editor works with what is granted — features whose scope is missing show it.
            </Text>
          </BlockStack>

          {missing.length > 0 && (
            <Banner tone="warning" title="Scopes this editor can use that your token does not have yet">
              <AccessNeeded scopes={missing} configUrl={appsAdminUrl(domain)} />
            </Banner>
          )}

          {groups.map((group) => (
            <BlockStack key={group} gap="150">
              <Text as="p" variant="headingSm">{group}</Text>
              {ALL_SCOPES.filter((scope) => SCOPE_INFO[scope].group === group).map((scope) => (
                <InlineStack key={scope} align="space-between" blockAlign="center" gap="300" wrap={false}>
                  <InlineStack gap="300" blockAlign="center" wrap={false}>
                    <ScopeChip scope={scope} />
                    <Text as="span" variant="bodySm" tone="subdued">{SCOPE_INFO[scope].enables}</Text>
                  </InlineStack>
                  <Badge tone={have.has(scope) ? "success" : "critical"}>{have.has(scope) ? "Granted" : "Missing"}</Badge>
                </InlineStack>
              ))}
            </BlockStack>
          ))}
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">Permissions</Text>
          <List>
            {capabilities.map((cap) => {
              const enabled = cap.scopes.every((s) => scopes.includes(s));
              return (
                <List.Item key={cap.id}>
                  <InlineStack align="space-between">
                    <Text as="span">{cap.label}</Text>
                    <Badge tone={enabled ? "success" : undefined}>{enabled ? "On" : "Off"}</Badge>
                  </InlineStack>
                </List.Item>
              );
            })}
          </List>
          <Button url="/connect/permissions" variant="plain">
            Change what this editor can access
          </Button>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
