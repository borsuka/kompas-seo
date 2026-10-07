import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export const ignores = {
  ignores: [
    '**/dist/**',
    '**/.next/**',
    '**/coverage/**',
    '**/.turbo/**',
    '**/node_modules/**',
    '**/drizzle/**',
    '**/next-env.d.ts',
    '**/playwright-report/**',
    '**/test-results/**',
  ],
};

export const baseConfig = tseslint.config(
  ignores,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**', '**/e2e/**', '**/scripts/**'],
    rules: { 'no-console': 'off' },
  },
);

export default baseConfig;
