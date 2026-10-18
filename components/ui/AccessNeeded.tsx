"use client";

import { useState } from "react";
import {
  Badge,
  BlockStack,
  Button,
  InlineStack,
  List,
  Text,
} from "@shopify/polaris";
import { SCOPE_INFO } from "@/lib/scopeInfo";

/** A scope name as a copyable chip: click to copy it, then paste it into the app's scope list in Shopify. */
export function ScopeChip({ scope }: { scope: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(scope);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — the name is still on screen to type
    }
  };
  return (
    <button
      type="button"
      className="scope-chip"
      onClick={copy}
      title={SCOPE_INFO[scope]?.enables ?? "Copy"}
      aria-label={`Copy ${scope}`}
    >
      <code>{scope}</code>
      <span className="scope-chip-state">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

/**
 * "Access you need to give": the scope names to add, what each is for, and the steps in Shopify
 * to add them. Used under errors that name a missing scope and on the Store connection page.
 */
export function AccessNeeded({
  scopes,
  alreadyGranted = [],
  protectedData = false,
  planLimited = false,
  configUrl,
}: {
  /** Scopes still to add. */
  scopes: string[];
  /** Scopes the error named that the token already has — shown ticked, so nobody re-adds them. */
  alreadyGranted?: string[];
  protectedData?: boolean;
  planLimited?: boolean;
  /** Link to the app's configuration (or the apps list) in the Shopify admin. */
  configUrl?: string;
}) {
  return (
    <BlockStack gap="300">
      {alreadyGranted.length > 0 && (
        <BlockStack gap="100">
          <Text as="p" variant="headingSm">
            Already granted
          </Text>
          <InlineStack gap="200">
            {alreadyGranted.map((scope) => (
              <Badge key={scope} tone="success" progress="complete">
                {scope}
              </Badge>
            ))}
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">
            These scopes are on your token — nothing to add for them.
          </Text>
        </BlockStack>
      )}

      {scopes.length > 0 && (
        <BlockStack gap="150">
          <Text as="p" variant="headingSm">
            Access to give this app
          </Text>
          <InlineStack gap="200">
            {scopes.map((scope) => (
              <ScopeChip key={scope} scope={scope} />
            ))}
          </InlineStack>
          <BlockStack gap="050">
            {scopes
              .filter((scope) => SCOPE_INFO[scope])
              .map((scope) => (
                <Text key={scope} as="p" variant="bodySm" tone="subdued">
                  <code>{scope}</code> — {SCOPE_INFO[scope].enables}
                </Text>
              ))}
          </BlockStack>
        </BlockStack>
      )}

      {protectedData && (
        <BlockStack gap="100">
          <Text as="p" variant="headingSm">
            Protected customer data access
          </Text>
          <Text as="p" variant="bodySm">
            Customer names, emails, phone numbers and addresses are personal
            data, so Shopify asks for a separate approval on top of the access
            scope (the &quot;Includes personally identifiable information&quot; note next
            to <code>read_customers</code>). In the app&apos;s configuration
            open{" "}
            <strong>
              API access requests → Protected customer data access
            </strong>
            , choose what you need (name, email, phone, address) and save — then{" "}
            <strong>Install</strong> or <strong>Update</strong> the app again
            and paste the new access token in Reconnect.
            {planLimited
              ? " Shopify also limits personal customer data to the Shopify, Advanced and Plus plans, so on a Basic plan the Customers pages cannot show it."
              : ""}
          </Text>
        </BlockStack>
      )}

      {scopes.length > 0 && (
        <BlockStack gap="100">
          <Text as="p" variant="headingSm">
            How to add it
          </Text>
          <List type="number">
            <List.Item>
              In Shopify admin open{" "}
              <strong>Settings → Apps and sales channels → Develop apps</strong>{" "}
              and choose this app.
            </List.Item>
            <List.Item>
              Open <strong>Configuration</strong> and, under{" "}
              <strong>Admin API integration</strong>, tick the scope names
              above, then <strong>Save</strong>.
            </List.Item>
            <List.Item>
              Click <strong>Install app</strong> (or <strong>Update</strong>) so
              Shopify issues a token with the new access, copy the new Admin API
              access token, and paste it in <strong>Reconnect</strong>.
            </List.Item>
          </List>
        </BlockStack>
      )}

      {configUrl && (
        <InlineStack>
          <Button url={configUrl} external variant="primary">
            Open the app in Shopify
          </Button>
        </InlineStack>
      )}
    </BlockStack>
  );
}
