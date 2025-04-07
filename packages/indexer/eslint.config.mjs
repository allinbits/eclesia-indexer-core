import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import stylisticTs from "@stylistic/eslint-plugin-ts";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    name: "app/files-to-lint",
    files: ["**/*.{ts,mts,tsx}"]
  },

  {
    name: "app/files-to-ignore",
    ignores: ["**/lib/**", "**/dist-ssr/**", "**/dist/**", "**/coverage/**", "**/*.js"]
  },
  {
    plugins: {
      "@stylistic/ts": stylisticTs
    }
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  stylisticTs.configs["all"],
  {
    rules: {
      "@stylistic/ts/indent": ["error", 2],
      "@stylistic/ts/quote-props": ["error", "as-needed"],
      "@stylistic/ts/block-spacing": ["error", "always"],
      "@stylistic/ts/object-curly-spacing": ["error", "always"],
      "@stylistic/ts/semi": ["error", "always"],
      "@stylistic/ts/quotes": ["error", "double"],
      "@stylistic/ts/comma-spacing": ["error", { before: false,
        after: true }],
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error", // or "error"
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_"
        }
      ],
      "max-lines": [
        "warn",
        { max: 500,
          skipBlankLines: true,
          skipComments: true }
      ],
      "max-lines-per-function": [
        "warn",
        { max: 120,
          skipBlankLines: true,
          skipComments: true }
      ]
    }
  }
  
];
