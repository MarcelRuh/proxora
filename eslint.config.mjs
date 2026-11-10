import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Compiler-style rules; form defaults and "latest callback" refs are intentional.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "next-env.d.ts",
    "coverage/**",
    "docker/**",
    "desktop/src-tauri/target/**",
    "desktop/node_modules/**",
    "android/**/build/**",
    "android/.gradle/**",
  ]),
]);

export default eslintConfig;
