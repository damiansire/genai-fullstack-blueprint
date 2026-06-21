// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Config de ESLint (flat) mínima para el API Node/TS del monorepo.
 * Aplica las recomendaciones base de ESLint + typescript-eslint sobre src/.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
  },
);
