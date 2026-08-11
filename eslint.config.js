import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.wrangler/**",
      "apps/cloudflare/tmp/**",
      "apps/portal/public/**",
    ],
  },
  {
    files: [
      "apps/**/*.ts",
      "apps/**/*.tsx",
      "packages/**/*.ts",
      "packages/**/*.tsx",
      "scripts/**/*.ts",
      "scripts/**/*.tsx",
    ],
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
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@guild/*/src", "@guild/*/src/**", "**/packages/*/src/**"],
              message: "Import through an explicit @guild package public export.",
            },
          ],
        },
      ],
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
    ignores: [
      "apps/portal/components/**/*.test.ts",
      "apps/portal/components/**/*.test.tsx",
      "apps/portal/components/feature/admin/AdminRolesSection.tsx",
      "apps/portal/components/feature/admin/api-test/request-builders.ts",
      "apps/portal/components/feature/events/EventCardsView.tsx",
      "apps/portal/components/feature/events/RecurringTemplateFormModal.tsx",
      "apps/portal/components/feature/guild-war/GuildWarAnalyticsTab.tsx",
      "apps/portal/components/feature/guild-war/GuildWarDragBoardSections.tsx",
      "apps/portal/components/shared/TipTapEditor.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/api/client", "**/api/mutations/*", "**/api/queries/*"],
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
  {
    files: ["scripts/**/*.mjs"],
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["apps/portal/hooks/**/*.ts", "apps/portal/hooks/**/*.tsx"],
    ignores: [
      // These two controllers still compose feature UI and are migration boundaries.
      "apps/portal/hooks/useAdminMemberDetail.ts",
      "apps/portal/hooks/guild-war/useGuildWarDragController.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/components/feature/**"],
              message: "Hooks must depend on domain types/services, not feature component implementations.",
            },
          ],
        },
      ],
    },
  },
];
