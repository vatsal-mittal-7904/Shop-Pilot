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
    "test-*.js",
    "test-*.ts",
    // One-off codemod scripts left in the repo root (patch_inventory.js,
    // patch_payment.js, ...). They are plain CommonJS node scripts whose
    // edits are already applied to src/, so linting them as project TypeScript
    // only fails the build on `require()`. Same rationale as test-* above.
    "patch_*.js",
    // Same category, different prefix -- these were producing 9 of the 10
    // `no-require-imports` errors from `npm run lint`.
    "fix_*.js",
    "check_edges.js",
    // Ad-hoc debug scripts, not part of the app.
    "scratch/**",
  ]),
]);

export default eslintConfig;
