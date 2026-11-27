import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` blocks cross-origin requests to dev-only assets by default
  // (DNS-rebinding protection) — without this, loading the app from another
  // device's IP on the same network (e.g. http://192.168.1.22:3000) leaves
  // the page looking loaded but silently broken: typed input still shows
  // (native DOM behavior) but React never receives dev-server responses, so
  // nothing downstream — like the connect page's Continue button — updates.
  // Next.js deliberately refuses a bare "*" wildcard here (it would allow
  // literally any site on the internet to probe the dev server), so this
  // scopes it to the private LAN ranges instead — any device on the same
  // network can load it, the open internet still can't.
  allowedDevOrigins: [
    "192.168.*.*",
    "10.*.*.*",
    // 172.16.0.0–172.31.255.255 (RFC 1918) — each second octet has to be
    // listed explicitly since the matcher only supports whole-segment
    // wildcards, not partial ones like "172.2*".
    "172.16.*.*",
    "172.17.*.*",
    "172.18.*.*",
    "172.19.*.*",
    "172.20.*.*",
    "172.21.*.*",
    "172.22.*.*",
    "172.23.*.*",
    "172.24.*.*",
    "172.25.*.*",
    "172.26.*.*",
    "172.27.*.*",
    "172.28.*.*",
    "172.29.*.*",
    "172.30.*.*",
    "172.31.*.*",
  ],

  // A native (Skia) image library: it must be loaded from node_modules at runtime, not bundled — the Background customiser's
  // server runs draw their pictures with it.
  serverExternalPackages: ["@napi-rs/canvas"],

  experimental: {
    // Polaris and its icon set are huge barrel files — a single
    // `import { Button } from "@shopify/polaris"` otherwise pulls the whole
    // module graph into every route, which is the bulk of both the dev
    // compile time and the client bundle here.
    optimizePackageImports: ["@shopify/polaris", "@shopify/polaris-icons"],
  },
};

export default nextConfig;
