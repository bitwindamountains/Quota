import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  { ignores: ['dist/**', 'node_modules/**', '.scratch/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended, ...ts.configs.recommended,
  { languageOptions: { globals: { process: 'readonly', console: 'readonly', setTimeout: 'readonly' } },
    rules: { '@typescript-eslint/no-explicit-any': 'error' } }
);
