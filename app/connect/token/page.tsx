"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Card, BlockStack, InlineStack, Text, TextField, Button, Banner } from "@shopify/polaris";
import { useOnboarding } from "@/components/onboarding/OnboardingContext";
import { scopesFor } from "@/lib/scopes";

type TestState = "idle" | "testing" | "success" | "error";

/** A write scope also covers reading the same thing, so a held write_x satisfies a wanted read_x. */
function isCovered(wanted: string, granted: string[]): boolean {
  return granted.includes(wanted) || (wanted.startsWith("read_") && granted.includes(`write_${wanted.slice(5)}`));
}

export default function TokenPage() {
  const router = useRouter();
  const { storeName, capabilityIds } = useOnboarding();
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<TestState>("idle");
  const [shopName, setShopName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What Shopify says this key can do (null when it could not be read), checked against the capabilities picked earlier.
  const [granted, setGranted] = useState<string[] | null>(null);
  const wanted = scopesFor(capabilityIds);
  const missing = granted ? wanted.filter((scope) => !isCovered(scope, granted)) : [];

  const testConnection = async () => {
    if (!token.trim() || !storeName) return;
    setStatus("testing");
    setError(null);
    try {
      const res = await fetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeName,
          token: token.trim(),
          scopes: scopesFor(capabilityIds),
        }),
      });
      const data = (await res.json()) as { ok: boolean; shopName?: string; granted?: string[] | null; error?: string };
      if (data.ok) {
        setStatus("success");
        setShopName(data.shopName ?? storeName);
        setGranted(data.granted ?? null);
        const gaps = data.granted ? scopesFor(capabilityIds).filter((scope) => !isCovered(scope, data.granted ?? [])) : [];
        // Missing scopes are shown, not hidden: give them time to be read before moving on.
        window.setTimeout(() => router.push("/home"), gaps.length > 0 ? 6000 : 1400);
      } else {
        setStatus("error");
        setError(data.error ?? "Couldn't verify that token.");
      }
    } catch {
      setStatus("error");
      setError("Couldn't reach the server. Check your connection and try again.");
    }
  };

  return (
    <BlockStack gap="400">
      <BlockStack gap="150">
        <Text as="h1" variant="headingLg">Paste your access token</Text>
        <Text as="p" tone="subdued">
          Copy the Admin API access token from the API credentials tab and paste it here. It&apos;s only
          used to talk to {storeName ? `${storeName}.myshopify.com` : "your store"}.
        </Text>
      </BlockStack>

      <Card>
        <BlockStack gap="400">
          <TextField
            label="Admin API access token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(v) => {
              setToken(v);
              setStatus("idle");
              setGranted(null);
            }}
            placeholder="shpat_••••••••••••••••••••••••"
          />

          {status === "success" && (
            <Banner tone="success">
              <p>✓ Connected to {shopName} — you&apos;re signed in. Taking you in…</p>
            </Banner>
          )}
          {status === "success" && granted && (
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                {missing.length === 0 ? "This key has every scope you chose" : `This key is missing ${missing.length} of the ${wanted.length} scopes you chose`}
              </Text>
              <InlineStack gap="150" wrap>
                {wanted.map((scope) => (
                  <Badge key={scope} tone={isCovered(scope, granted) ? "success" : "critical"}>
                    {`${isCovered(scope, granted) ? "✓" : "✗"} ${scope}`}
                  </Badge>
                ))}
              </InlineStack>
              {missing.length > 0 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  Add the red scopes in your custom app (Configuration → Admin API scopes), save, then reinstall the app and paste the new token. Tools that need them will ask for them until you do.
                </Text>
              )}
            </BlockStack>
          )}
          {status === "error" && (
            <Banner tone="critical">
              <p>{error}</p>
            </Banner>
          )}

          <Button onClick={testConnection} disabled={!token.trim()} loading={status === "testing"}>
            Test connection
          </Button>
        </BlockStack>
      </Card>

      <InlineStack align="space-between">
        <Button onClick={() => router.push("/connect/instructions")}>Back</Button>
        <Button variant="primary" disabled={status !== "success"} onClick={() => router.push("/home")}>
          Done
        </Button>
      </InlineStack>
    </BlockStack>
  );
}
