// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    // Referenciar un método de un mock (p.ej. `expect(store.append)...`) es
    // un patrón normal y seguro en tests con Jest, no un bug de `this`.
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    // Mk-Api.md §3.1/§5.1: api/ depende solo de application/ y core/, nunca
    // de infrastructure/ (Tipminer, Telegram, Prisma). Única regla de
    // fronteras entre capas verificada por CI en todo el repo hasta ahora.
    files: ['src/api/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/infrastructure/**'],
              message:
                'api/ nunca importa infrastructure/ (Mk-Api.md §3.1). Usa un servicio de application/ en su lugar.',
            },
          ],
        },
      ],
    },
  },
);
