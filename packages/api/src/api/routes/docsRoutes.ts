// Stability: 2 - Stable
import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../../core/logger.js';

/**
 * OpenAPI documentation route.
 *
 * Following the "graceful degradation" principle (AGENTS.md): the OpenAPI
 * document is generated from Zod schemas via `@asteasolutions/zod-to-openapi`,
 * an OPTIONAL dependency. Generating API docs is not critical for the gateway's
 * runtime, so a missing package must never crash the boot.
 *
 * The package is therefore loaded lazily (dynamic `import()`) inside the route
 * handler. If it is not installed, the `/docs/openapi.json` endpoint degrades to
 * a clear 503 instead of taking down the whole server with ERR_MODULE_NOT_FOUND.
 */

const aiResponseSchema = z.object({
  success: z.boolean(),
  data: z.any(),
});

// Minimal structural type for the slice of the package we consume. Avoids a
// hard compile-time dependency on a package that may not be installed.
interface ZodToOpenApi {
  extendZodWithOpenApi: (zod: typeof z) => void;
  OpenAPIRegistry: new () => {
    register: (name: string, schema: unknown) => unknown;
    registerPath: (config: unknown) => void;
    definitions: unknown;
  };
  OpenApiGeneratorV3: new (definitions: unknown) => {
    generateDocument: (config: unknown) => unknown;
  };
}

let cachedDocument: unknown | null = null;

async function buildOpenApiDocument(): Promise<unknown> {
  if (cachedDocument) return cachedDocument;

  // Lazy load: keep the optional dependency off the boot path.
  // The specifier is built indirectly so `tsc` does not try to resolve the
  // (optional, possibly-uninstalled) module at compile time — it stays a pure
  // runtime concern that degrades to a 503 when absent (see handler below).
  const optionalDep = '@asteasolutions/zod-to-openapi';
  const mod = (await import(/* @vite-ignore */ optionalDep)) as unknown as ZodToOpenApi;
  const { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } = mod;

  extendZodWithOpenApi(z);

  const registry = new OpenAPIRegistry();
  registry.register('AiResponse', aiResponseSchema);

  registry.registerPath({
    method: 'post',
    path: '/api/models/{modelId}/invoke',
    description: 'Invokes an AI model with the given intent and context',
    summary: 'Invoke Model',
    request: {
      params: z.object({
        modelId: z.string(),
      }),
    },
    responses: {
      200: {
        description: 'Successful AI response',
        content: {
          'application/json': {
            schema: aiResponseSchema,
          },
        },
      },
    },
  });

  const generator = new OpenApiGeneratorV3(registry.definitions);
  cachedDocument = generator.generateDocument({
    openapi: '3.0.0',
    info: {
      version: '1.0.0',
      title: 'GenAI-Scaffold API',
      description: 'API documentation generated from Zod schemas',
    },
    servers: [{ url: '/api' }],
  });

  return cachedDocument;
}

export const docsRoutes = Router();

docsRoutes.get('/openapi.json', async (_req, res) => {
  try {
    const document = await buildOpenApiDocument();
    res.json(document);
  } catch (error) {
    // Missing optional dependency (ERR_MODULE_NOT_FOUND) or generation failure.
    logger.warn(
      'OpenAPI docs unavailable: optional dependency "@asteasolutions/zod-to-openapi" is not installed or failed to load. The /docs endpoint is disabled.',
      { dependency: '@asteasolutions/zod-to-openapi' },
    );
    res.status(503).json({
      error: 'OpenAPI documentation is unavailable',
      reason: 'The optional documentation dependency is not installed.',
    });
  }
});
