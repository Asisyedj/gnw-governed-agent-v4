// ESLint v9 flat config
import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

const nodeGlobals = {
  process: "readonly", Buffer: "readonly", NodeJS: "readonly",
  console: "readonly", fetch: "readonly", setTimeout: "readonly",
  clearTimeout: "readonly", crypto: "readonly",
};
const browserGlobals = {
  window: "readonly", document: "readonly", console: "readonly",
  fetch: "readonly", React: "readonly",
};

export default [
  js.configs.recommended,
  {
    files: ["src/server/**/*.ts", "src/executor/**/*.ts", "src/tests/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: "./tsconfig.json", ecmaVersion: 2022, sourceType: "module" },
      globals: nodeGlobals,
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      ...tsPlugin.configs["recommended"].rules,
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/explicit-function-return-type": "off",
      "no-console": ["warn", { allow: ["error", "warn"] }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "eqeqeq": ["error", "always"],
    },
  },
  {
    files: ["src/client/**/*.ts", "src/client/**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: "./tsconfig.json", ecmaVersion: 2022, sourceType: "module", jsx: true },
      globals: browserGlobals,
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      ...tsPlugin.configs["recommended"].rules,
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/explicit-function-return-type": "off",
      "no-console": ["warn", { allow: ["error", "warn"] }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "eqeqeq": ["error", "always"],
    },
  },
  {
    files: ["src/tests/**/*.ts"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "drizzle/**"],
  },
];