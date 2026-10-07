import { baseConfig } from '../../eslint.config.js';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    languageOptions: {
      // Lets type-import rules see that Nest's decorator metadata needs value imports.
      parserOptions: { emitDecoratorMetadata: true, experimentalDecorators: true },
    },
  },
];
