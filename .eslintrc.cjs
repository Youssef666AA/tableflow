/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { browser: true, node: true, es2022: true },
  settings: { react: { version: 'detect' } },
  rules: {
    // The codebase leans on inference; an explicit return type everywhere is noise.
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    // `any` is a smell, not a crime — flag it without failing the build.
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
    ],
    // Non-null assertions are used deliberately after an explicit guard.
    '@typescript-eslint/no-non-null-assertion': 'off',
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    eqeqeq: ['error', 'smart'],
    'prefer-const': 'error',
    'no-var': 'error',
  },
  overrides: [
    {
      // Scripts and the seed are CLI tools; writing to stdout is their job.
      files: ['apps/api/scripts/**/*.ts', 'apps/api/src/seed/**/*.ts', '**/*.config.ts'],
      rules: { 'no-console': 'off' },
    },
    {
      files: ['**/*.test.ts', '**/*.test.tsx', 'e2e/**/*.ts'],
      rules: { '@typescript-eslint/no-explicit-any': 'off', 'no-console': 'off' },
    },
  ],
  ignorePatterns: [
    'node_modules',
    'dist',
    'build',
    'coverage',
    'playwright-report',
    'test-results',
    '.pgdata',
    'apps/api/prisma/migrations',
    'apps/web/public/sw.js',
  ],
};
