import fs from "node:fs";

import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

const portalExemptions = JSON.parse(
  fs.readFileSync(new URL("./apps/portal/.eslintrc-exemptions.json", import.meta.url), "utf8"),
);

const legacyPortalFiles = [
  ...(portalExemptions["legacy-pages"] ?? []),
  ...(portalExemptions["legacy-components"] ?? []),
].map((file) => `apps/portal/${file}`);

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "apps/worker/.wrangler/**",
      "apps/portal/public/**",
    ],
  },
  {
    files: ["apps/**/*.ts", "apps/**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "react-hooks": reactHooks,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["apps/portal/components/**/*.ts", "apps/portal/components/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/api/mutations/*", "**/api/queries/*"],
              message: "Import from the services layer, not portal API modules directly.",
            },
            {
              group: ["../../../api/*"],
              message: "Feature components should receive data through services or props.",
            },
          ],
        },
      ],
      "max-lines": [
        "warn",
        {
          max: 500,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
    },
  },
  {
    files: ["apps/portal/services/**/*.ts", "apps/portal/services/**/*.tsx"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  ...(legacyPortalFiles.length > 0
    ? [
        {
          files: legacyPortalFiles,
          rules: {
            "no-restricted-imports": "off",
            "max-lines": "off",
          },
        },
      ]
    : []),
  {
    files: ["apps/worker/**/*.ts"],
    rules: {
      "max-lines": [
        "warn",
        {
          max: 300,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      "max-lines-per-function": [
        "warn",
        {
          max: 50,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
    },
  },
];
