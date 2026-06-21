// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Config de ESLint (flat) para el API Node/TS del monorepo.
 *
 * Aplica las recomendaciones base de ESLint + typescript-eslint sobre src/.
 *
 * Acotaciones deliberadas (gate VERDE sin explotar el alcance):
 *   - `no-explicit-any` queda en `warn`: el `any` de frontera es deuda
 *     conocida y rastreada aparte (hallazgo P10 de la auditoría). Se baja a
 *     warning para que sea visible sin bloquear el gate mientras se migra a
 *     `safeParse`/tipos de dominio incrementalmente.
 *   - `no-unused-vars` ignora identificadores prefijados con `_` (convención
 *     del repo para params requeridos por firma pero sin usar) y no chequea
 *     variables de `catch` (muchos handlers capturan sin inspeccionar).
 *   - Reglas nuevas de ESLint 10 más estrictas que el código aún no cumple
 *     (`preserve-caught-error`) quedan en `warn` para no forzar una reescritura
 *     masiva de los sitios de `throw`.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
      // Merge de declaraciones (augmentación de Express) usa namespaces a propósito.
      '@typescript-eslint/no-namespace': 'off',
      // Deuda de tipado de frontera rastreada en P10.
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      // Regla nueva de ESLint 10: encadenar `cause` es deseable pero no se fuerza aún.
      'preserve-caught-error': 'warn',
    },
  },
  {
    // Specs: tolerancia con imports/symbols de andamiaje no usados.
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
