// @ts-check
const tseslint = require('typescript-eslint');
const playwright = require('eslint-plugin-playwright');

// Tests import test/expect from @fixtures, never straight from @playwright/test.
const fixturesOnly = [{ name: '@playwright/test', message: "Import { test, expect } from '@fixtures'." }];

/**
 * Keeps each suite in its lane: a suite may use shared code, but not another suite's
 * page objects or API client. (ESLint keeps only the last value of a rule, so each
 * suite's entry repeats the fixturesOnly paths.)
 */
const suiteBoundary = (forbidden) => ({
  'no-restricted-imports': [
    'error',
    {
      paths: fixturesOnly,
      patterns: forbidden.map((group) => ({ group: [group], message: 'This belongs to another suite.' })),
    },
  ],
});

module.exports = tseslint.config(
  { ignores: ['node_modules/', 'playwright-report/', 'test-results/', 'reports/'] },
  ...tseslint.configs.recommended,
  { files: ['**/*.js'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  // `const { region, ...rest } = payload` is how a field is dropped from a payload.
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }] } },
  {
    files: ['tests/**/*.ts'],
    ...playwright.configs['flat/recommended'],
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      'playwright/no-wait-for-timeout': 'error', // no fixed waits — the #1 Cypress habit to drop
      'playwright/no-focused-test': 'error',
      // test.skip(condition, reason) is allowed: a test that needs a DB row which does
      // not exist reports "skipped: <reason>" instead of passing without testing anything.
      'playwright/no-skipped-test': ['error', { allowConditional: true }],
      // Page-object methods named expect*() count as assertions.
      'playwright/expect-expect': ['warn', { assertFunctionPatterns: ['^expect', '\\.expect\\w+$'] }],
      'no-restricted-imports': ['error', { paths: fixturesOnly }],
    },
  },
  // In the UI suites the page-object methods assert (e.g. openInvoice waits for the URL),
  // which this rule cannot see.
  { files: ['tests/hub-e2e/**/*.ts', 'tests/checkout-e2e/**/*.ts', 'tests/pos-e2e/**/*.ts', 'tests/css-e2e/**/*.ts'], rules: { 'playwright/expect-expect': 'off' } },
  { files: ['tests/hub-e2e/**/*.ts'], rules: suiteBoundary(['@pages/checkout/*', '@pages/pos/*', '@pages/css/*', '@api/unified-api/*', '@api/customer-api/*']) },
  { files: ['tests/checkout-e2e/**/*.ts'], rules: suiteBoundary(['@pages/hub/*', '@pages/pos/*', '@pages/css/*', '@api/unified-api/*', '@api/customer-api/*', '@api/hub-api/*']) },
  { files: ['tests/pos-e2e/**/*.ts'], rules: suiteBoundary(['@pages/hub/*', '@pages/checkout/*', '@pages/css/*', '@api/unified-api/*', '@api/customer-api/*', '@api/hub-api/*']) },
  { files: ['tests/css-e2e/**/*.ts'], rules: suiteBoundary(['@pages/hub/*', '@pages/checkout/*', '@pages/pos/*', '@api/unified-api/*', '@api/customer-api/*', '@api/hub-api/*']) },
  { files: ['tests/customer-api/**/*.ts'], rules: suiteBoundary(['@pages/*', '@api/unified-api/*', '@api/hub-api/*']) },
  { files: ['tests/unified-api/**/*.ts'], rules: suiteBoundary(['@pages/*', '@api/customer-api/*', '@api/hub-api/*']) },
);
