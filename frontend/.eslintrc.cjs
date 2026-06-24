module.exports = {
  env: {
    browser: true,
    es2021: true,
  },
  extends: ["eslint:recommended", "plugin:react/recommended"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
    ecmaVersion: "latest",
    project: ["./tsconfig.eslint.json"],
    sourceType: "module",
    tsconfigRootDir: __dirname,
  },
  settings: {
    react: {
      version: "detect",
    },
  },
  plugins: ["react"],
  overrides: [
    {
      files: ["**/*.{ts,tsx}"],
      rules: {
        "no-undef": "off",
        "no-unused-vars": "off",
        "react/prop-types": "off",
      },
    },
    {
      files: ["*.config.ts", "e2e/**/*.{ts,tsx}"],
      env: {
        node: true,
      },
    },
    {
      files: ["src/**/*.test.{ts,tsx}", "src/**/__tests__/**/*.{ts,tsx}"],
      globals: {
        afterAll: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        beforeEach: "readonly",
        describe: "readonly",
        expect: "readonly",
        it: "readonly",
        test: "readonly",
        vi: "readonly",
      },
    },
  ],
  rules: {
    "react/react-in-jsx-scope": "off",
  },
};
