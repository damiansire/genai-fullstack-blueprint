// @ts-check
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';

/**
 * Config de ESLint (flat) para el client Angular 21 del monorepo.
 *
 * Replica la convención del repo hermano (web-worker-patterns) y los invariantes
 * que AGENTS.md predica para este paquete:
 *   1. no-console en el código de la app (src/, fuera de specs): nada de console.*
 *      colado en producción.
 *   2. prefer OnPush: el client es zoneless y predica OnPush; lo hacemos cumplir
 *      por lint (prefer-on-push-component-change-detection) para que no se degrade.
 *   3. a11y de teclado en plantillas: todo lo clickeable tiene que ser operable por
 *      teclado y enfocable.
 */
export default tseslint.config(
  {
    // Solo el código de la app. Specs quedan fuera.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.spec.ts'],
    extends: [...tseslint.configs.recommended, ...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      // (1) sin `console.log/debug/info` de depuracion en la lib; se permiten
      //     `console.warn`/`console.error` como diagnostico legitimo de fallos
      //     de boundary (schema mismatch) y bootstrap.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // (2) OnPush obligatorio: el client es zoneless y lo predica.
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@angular-eslint/component-selector': 'off',
      '@angular-eslint/directive-selector': 'off',
      // Deuda de tipado de frontera rastreada aparte (P10): visible pero no bloquea.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Outputs con prefijo `on`/nombre de evento DOM: renombrarlos es un cambio
      // de API publica con re-wiring de plantillas; se deja como warning.
      '@angular-eslint/no-output-on-prefix': 'warn',
      '@angular-eslint/no-output-native': 'warn',
    },
  },
  {
    // Plantillas (HTML externo + plantillas inline procesadas arriba).
    files: ['src/**/*.html'],
    extends: [...angular.configs.templateRecommended],
    rules: {
      // `x != null` es el chequeo idiomático de null-y-undefined a la vez; permitirlo.
      '@angular-eslint/template/eqeqeq': ['error', { allowNullOrUndefined: true }],
      // (3) a11y de teclado: lo clickeable debe ser operable por teclado y enfocable.
      '@angular-eslint/template/click-events-have-key-events': 'error',
      '@angular-eslint/template/mouse-events-have-key-events': 'error',
      '@angular-eslint/template/interactive-supports-focus': 'error',
      '@angular-eslint/template/no-positive-tabindex': 'error',
      '@angular-eslint/template/role-has-required-aria': 'error',
      '@angular-eslint/template/valid-aria': 'error',
    },
  },
);
