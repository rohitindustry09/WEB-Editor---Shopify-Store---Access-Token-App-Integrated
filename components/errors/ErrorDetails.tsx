"use client";

import { useEffect, useState } from "react";
import { BlockStack, Text } from "@shopify/polaris";
import { appsAdminUrl, describeApiError } from "@/lib/apiErrors";
import { AccessNeeded } from "@/components/ui/AccessNeeded";
import { useStoreDomain } from "@/components/nav/StoreContext";
import { useErrorCenter } from "@/components/errors/ErrorCenter";
import { grantedScopesAction } from "@/app/actions/scopes";

/**
 * What one error says, in full: a plain headline, the message (repeats collapsed), and — when the
 * error is about access — the scopes to add, what is already granted, and how to add them.
 * The scopes are checked against what the token really has, so you are never asked for one you already gave.
 */
export function ErrorDetails({ error }: { error: string }) {
  const info = describeApiError(error);
  const domain = useStoreDomain();
  const center = useErrorCenter();
  // Inside the app shell the error centre has already read the token's scopes; outside it this asks for itself.
  const [localGranted, setLocalGranted] = useState<string[] | null>(null);
  const granted = center ? center.grantedScopes : localGranted;
  const scopeKey = info.scopes.join(",");

  useEffect(() => {
    if (center || !scopeKey) return;
    let cancelled = false;
    void grantedScopesAction().then((result) => {
      if (!cancelled) setLocalGranted(result);
    });
    return () => {
      cancelled = true;
    };
  }, [center, scopeKey]);

  const missing = granted ? info.scopes.filter((scope) => !granted.includes(scope)) : info.scopes;
  const alreadyGranted = granted ? info.scopes.filter((scope) => granted.includes(scope)) : [];
  const needsAccess = missing.length > 0 || info.protectedData;
  const scopesAreFine = granted !== null && missing.length === 0 && info.scopes.length > 0;

  const headline = info.protectedData
    ? scopesAreFine
      ? "Scopes are granted — Shopify still needs protected customer data approval"
      : "This needs protected customer data access"
    : needsAccess
      ? "Shopify needs more access for this"
      : "Couldn't load this from Shopify";

  return (
    <BlockStack gap="300">
      <Text as="h3" variant="headingSm">
        {headline}
      </Text>
      <Text as="p" variant="bodySm" breakWord>
        {info.message}
      </Text>
      {needsAccess && (
        <AccessNeeded
          scopes={missing}
          alreadyGranted={alreadyGranted}
          protectedData={info.protectedData}
          planLimited={info.planLimited}
          configUrl={info.settingsUrl ?? appsAdminUrl(domain)}
        />
      )}
    </BlockStack>
  );
}
