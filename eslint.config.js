// Code-style and mistake checks: `npx eslint .` (also runs in CI). Dev-only; nothing here ships.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'design/', 'test-results/', 'playwright-report/', '_site/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
      'no-implicit-globals': 'error',
      'no-shadow': ['error', { hoist: 'functions' }],
      'no-param-reassign': ['error', { props: false }],
      'consistent-return': 'off',
    },
  },
  // The app (browser)
  { files: ['js/**/*.js'], languageOptions: { globals: globals.browser } },
  // Service worker
  { files: ['sw.js'], languageOptions: { globals: globals.serviceworker } },
  // Server, tools, tests (Node)
  { files: ['server/**/*.mjs', 'tools/**/*.mjs', 'tests/**/*.js', 'e2e/**/*.js', '*.config.js'], languageOptions: { globals: globals.node } },
  // e2e tests also run code inside the page
  { files: ['e2e/**/*.js'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
];
