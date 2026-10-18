// Deliberately no `import "server-only"` here, unlike the rest of this
// module family — `MAX_SCAN_WORKERS` is needed by the client-side worker
// count picker too, so this file has to be safely importable from a
// "use client" component. Keep this in sync with anywhere the actual pool
// is sized (`backgroundScanPool.ts`'s own default already imports this
// constant rather than redefining it).
export const MAX_SCAN_WORKERS = 8;
export const DEFAULT_SCAN_WORKERS = 4;
