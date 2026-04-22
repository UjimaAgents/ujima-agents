// @ts-check
import tseslint from 'typescript-eslint';
import js from '@eslint/js';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/.vite/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.vsix',
      '**/.turbo/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
);
