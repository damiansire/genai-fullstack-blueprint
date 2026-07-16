import { describe, it, expect } from 'vitest';
import { routes } from './app.routes';

/**
 * The route table is domain configuration: every feature screen is lazy
 * (`loadComponent`) and titled. These specs pin that contract so a new route
 * cannot silently ship eager or untitled.
 */
describe('app.routes', () => {
  const lazyRoutes = routes.filter((r) => r.loadComponent);
  const redirects = routes.filter((r) => r.redirectTo);

  it('defaults the empty path to /text-model with a full match', () => {
    const root = routes.find((r) => r.path === '');
    expect(root?.redirectTo).toBe('/text-model');
    expect(root?.pathMatch).toBe('full');
  });

  it('routes are either lazy features or redirects (no eager components)', () => {
    expect(lazyRoutes.length + redirects.length).toBe(routes.length);
    expect(lazyRoutes.length).toBeGreaterThanOrEqual(9);
  });

  it('every lazy feature route declares a document title', () => {
    for (const route of lazyRoutes) {
      expect(route.title, `route "${route.path}" is missing a title`).toBeTruthy();
    }
  });

  it('keeps the legacy /image-model redirect pointing at /image-ocr', () => {
    const legacy = routes.find((r) => r.path === 'image-model');
    expect(legacy?.redirectTo).toBe('/image-ocr');
  });

  it('has a wildcard fallback so unknown URLs land on the default feature', () => {
    const wildcard = routes.find((r) => r.path === '**');
    expect(wildcard?.redirectTo).toBe('/text-model');
  });

  it('every loadComponent factory resolves to a component class', async () => {
    const resolved = await Promise.all(lazyRoutes.map((r) => r.loadComponent!()));
    for (const [i, component] of resolved.entries()) {
      expect(
        component,
        `route "${lazyRoutes[i]?.path}" lazy import resolved to nothing`,
      ).toBeTypeOf('function');
    }
  });
});
