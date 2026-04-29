export default {
  extends: ["../.eslintrc.js"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/api/mutations/*", "**/api/queries/*"],
            message: "Import from services instead of portal API modules.",
          },
          {
            group: ["../../../api/*"],
            message: "Feature components should receive data via services or props.",
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
  overrides: [
    {
      files: ["**/services/**/*.ts"],
      rules: {
        "no-restricted-imports": "off",
      },
    },
  ],
};
