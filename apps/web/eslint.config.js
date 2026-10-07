import nextVitals from 'eslint-config-next/core-web-vitals';
import i18next from 'eslint-plugin-i18next';
import { baseConfig } from '../../eslint.config.js';

const config = [
  ...baseConfig,
  ...nextVitals,
  {
    files: ['src/**/*.tsx'],
    plugins: { i18next },
    rules: {
      // No hardcoded UI text: every visible string comes from messages/*.json.
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-text-only',
          'jsx-attributes': { include: ['title', 'placeholder', 'alt', 'aria-label', 'label'] },
        },
      ],
    },
  },
  {
    ignores: ['.next/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**'],
  },
];

export default config;
