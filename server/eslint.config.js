// Catches missed `await`s on the async (PostgreSQL) stores.
import tseslint from 'typescript-eslint';
export default tseslint.config({
  files: ['src/**/*.ts'],
  languageOptions: { parser: tseslint.parser, parserOptions: { project: './tsconfig.json' } },
  plugins: { '@typescript-eslint': tseslint.plugin },
  rules: {
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { arguments: false } }],
    '@typescript-eslint/await-thenable': 'error',
  },
});
