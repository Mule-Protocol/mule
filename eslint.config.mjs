import tseslint from 'typescript-eslint';
export default tseslint.config({ ignores: ['**/dist/**', 'target/**', 'coverage/**'] }, ...tseslint.configs.recommended, { files: ['**/*.mjs'], languageOptions: { globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', URL: 'readonly' } } });
