import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vitest 4 transforms with oxc (not esbuild). Angular's `@Injectable`
  // decorators are legacy (experimentalDecorators) decorators, so they must be
  // enabled here or the transformed output fails to load with a SyntaxError.
  oxc: {
    decorator: { legacy: true, emitDecoratorMetadata: true },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/core/**/*.spec.ts'],
  },
});
