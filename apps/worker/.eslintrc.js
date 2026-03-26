export default {
  extends: ["../.eslintrc.js"],
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
};
