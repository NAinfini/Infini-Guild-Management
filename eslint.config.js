import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

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
  {
    files: ["apps/worker/**/*.ts"],
    ignores: [
      "apps/worker/**/*.test.ts",
      "apps/worker/tests/**",
      "apps/worker/db/seed.ts",
      "apps/worker/scripts/**",
      "apps/worker/crons/announcement-publish.ts",
      "apps/worker/crons/audit-archive.ts",
      "apps/worker/crons/event-instance-gen.ts",
      "apps/worker/crons/raffle-draw.ts",
      "apps/worker/index.ts",
      "apps/worker/routes/dashboard.ts",
      "apps/worker/services/AdminAuditService.ts",
      "apps/worker/services/AdminService.ts",
      "apps/worker/services/BadgeService.ts",
      "apps/worker/services/SearchService.ts",
      "apps/worker/services/UserService.ts",
      "apps/worker/services/WikiService.ts",
      "apps/worker/services/auth.ts",
      "apps/worker/services/events/EventCrudService.ts",
      "apps/worker/services/events/EventParticipantService.ts",
      "apps/worker/services/events/EventPollRaffleService.ts",
      "apps/worker/services/guild-war/GuildWarActiveService.ts",
      "apps/worker/services/guild-war/GuildWarHistoryService.ts",
    ],
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
