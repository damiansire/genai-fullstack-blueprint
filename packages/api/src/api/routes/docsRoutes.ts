// Stability: 2 - Stable
import { Router } from 'express';
// @ts-ignore - Assuming package will be installed or is available
import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

const aiResponseSchema = z.object({
  success: z.boolean(),
  data: z.any()
});

const registry = new OpenAPIRegistry();

// Register Schemas dynamically
registry.register('AiResponse', aiResponseSchema);

// Example route registration
registry.registerPath({
  method: 'post',
  path: '/api/models/{modelId}/invoke',
  description: 'Invokes an AI model with the given intent and context',
  summary: 'Invoke Model',
  request: {
    params: z.object({
      modelId: z.string()
    })
  },
  responses: {
    200: {
      description: 'Successful AI response',
      content: {
        'application/json': {
          schema: aiResponseSchema
        }
      }
    }
  }
});

export const docsRoutes = Router();

docsRoutes.get('/openapi.json', (_req, res) => {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  const document = generator.generateDocument({
    openapi: '3.0.0',
    info: {
      version: '1.0.0',
      title: 'GenAI-Scaffold API',
      description: 'API documentation generated from Zod schemas'
    },
    servers: [{ url: '/api' }]
  });

  res.json(document);
});
