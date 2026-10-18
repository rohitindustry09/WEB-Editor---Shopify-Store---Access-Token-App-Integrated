import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Plain CommonJS `worker_threads` targets — loaded directly by Node's
    // own module loader at runtime, outside Next's TS/bundler pipeline
    // (see `backgroundScanWorker.js`'s own note), so `require()` here is
    // the correct, necessary form, not a lint violation.
    files: ["server-workers/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
