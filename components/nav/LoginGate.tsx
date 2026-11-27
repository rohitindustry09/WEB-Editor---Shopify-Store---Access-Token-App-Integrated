"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Banner, BlockStack, Box, Button, Icon, InlineStack, Modal, Text, TextField } from "@shopify/polaris";
import { LockIcon, StoreIcon } from "@shopify/polaris-icons";
import { isOpenPage } from "@/lib/accessPolicy";

interface LoginGate {
  /** True when a Shopify store is connected. */
  loggedIn: boolean;
  /** Opens the login popup. */
  openLogin: () => void;
}

const LoginGateContext = createContext<LoginGate>({ loggedIn: false, openLogin: () => undefined });

export const useLoginGate = (): LoginGate => useContext(LoginGateContext);

/** A store's handle, from whatever was typed: "my-store", "my-store.myshopify.com" or a pasted admin address. */
function storeHandle(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^admin\.shopify\.com\/store\//, "")
    .replace(/\.myshopify\.com.*$/, "")
    .replace(/[/?#].*$/, "");
}

const VALID_HANDLE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function LoginModal({ open, onClose, oauthReady }: { open: boolean; onClose: () => void; oauthReady: boolean }) {
  const [store, setStore] = useState("");
  const [touched, setTouched] = useState(false);
  const handle = storeHandle(store);
  const valid = VALID_HANDLE.test(handle);

  const connect = () => {
    setTouched(true);
    if (!valid) return;
    // A real navigation, not a client-side one: this address answers with a redirect to Shopify's approval page.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- an API route that redirects off-site, not a Next page
    window.location.href = `/api/auth/shopify/start?shop=${encodeURIComponent(handle)}`;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log in with your Shopify store"
      primaryAction={oauthReady ? { content: "Connect with Shopify", onAction: connect } : { content: "Open the login page", url: "/connect" }}
      secondaryActions={oauthReady ? [{ content: "Use an access key instead", url: "/connect" }, { content: "Not now", onAction: onClose }] : [{ content: "Not now", onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <Text as="p">
            This part of the app works on your Shopify store, so it needs you to log in. The Background customiser, Background remover, Media format
            converter and SEO audit don&apos;t — you can use those without logging in.
          </Text>
          {oauthReady ? (
            <div
              onKeyDown={(event) => {
                if (event.key === "Enter") connect();
              }}
            >
              <TextField
                label="Your store"
                value={store}
                onChange={setStore}
                onBlur={() => setTouched(true)}
                suffix=".myshopify.com"
                placeholder="your-store"
                autoComplete="off"
                error={touched && !valid ? "Enter your store's name, like your-store." : undefined}
              />
            </div>
          ) : (
            <Banner tone="info">
              <p>Log in with your store&apos;s access key on the login page.</p>
            </Banner>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

/**
 * Holds the login popup for the whole app shell. A page that needs a Shopify store shows the popup by itself when nobody is logged
 * in, and any locked navigation item opens it on click (see `useLoginGate`).
 */
export function LoginGateProvider({ loggedIn, oauthReady, children }: { loggedIn: boolean; oauthReady: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const [clicked, setClicked] = useState(false);
  const [dismissedOn, setDismissedOn] = useState<string | null>(null);

  // Opened by a click, or automatically on a page that needs a store (until it is dismissed there).
  const onLockedPage = !loggedIn && !isOpenPage(pathname);
  const open = !loggedIn && (clicked || (onLockedPage && dismissedOn !== pathname));

  const value = useMemo<LoginGate>(() => ({ loggedIn, openLogin: () => setClicked(true) }), [loggedIn]);
  return (
    <LoginGateContext.Provider value={value}>
      {children}
      <LoginModal
        open={open}
        oauthReady={oauthReady}
        onClose={() => {
          setClicked(false);
          setDismissedOn(pathname);
        }}
      />
    </LoginGateContext.Provider>
  );
}

/** What a page that needs a Shopify store shows to someone who isn't logged in. */
export function LoginRequiredNotice() {
  const { openLogin } = useLoginGate();
  return (
    <Box padding="800">
      <BlockStack gap="400" inlineAlign="center">
        <Icon source={LockIcon} tone="subdued" />
        <Text as="h1" variant="headingLg">Log in to use this</Text>
        <Box maxWidth="460px">
          <Text as="p" tone="subdued" alignment="center">
            This page works on your Shopify store, so it needs you to log in first. The Background customiser, Background remover, Media format
            converter and SEO audit are free to use without logging in.
          </Text>
        </Box>
        <InlineStack gap="300">
          <Button variant="primary" icon={StoreIcon} onClick={openLogin}>Log in with Shopify</Button>
          <Button url="/tools/bg-customiser">Open the Background customiser</Button>
        </InlineStack>
      </BlockStack>
    </Box>
  );
}
