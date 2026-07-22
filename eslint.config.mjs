import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/build/**',
      '**/coverage/**',
      '**/.vite/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // Node build scripts (e.g. icon generation) run on Node, not in the renderer — give them the Node
  // globals they use so no-undef doesn't flag `console`/`process`.
  {
    files: ['**/scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', URL: 'readonly' },
    },
  },
  // Rules-of-hooks (hard error) + exhaustive-deps (warning) over the renderer's React code.
  // The plugin's full recommended set (react-hooks/refs, set-state-in-effect, …) is deliberately
  // not enabled: it forbids the ref-mirror and seed-on-open patterns this codebase uses on purpose.
  {
    files: ['**/*.tsx', 'apps/desktop/src/renderer/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  prettier,
);
