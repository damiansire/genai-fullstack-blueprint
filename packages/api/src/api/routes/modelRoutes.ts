import { Router, RequestHandler } from 'express';
import multer from 'multer';
import { ModelFactory } from '../../infrastructure/ai/factory.js';
import { SchemaRegistry } from '../../infrastructure/ai/registry.js';
import { apiKeyAuth } from '../middleware/apiKeyAuth.js';
import { rbacModelMiddleware } from '../middleware/rbac.js';
import { createDynamicValidationMiddleware } from '../middleware/dynamicValidation.js';
import {
  createModelController,
  createModelInfoController,
  createModelListController,
  createStreamController,
} from '../controllers/modelController.js';

/**
 * Create model routes with dependencies
 * @param modelFactory - Instance of ModelFactory
 * @param schemaRegistry - Instance of SchemaRegistry
 * @param postAuthChain - Cross-cutting middlewares (rate limiters, safety
 *   firewall) that must run AFTER authentication but before the controllers.
 *   Applied via router.use so auth is always the front gate.
 * @returns Express router
 */
export function createModelRoutes(
  modelFactory: ModelFactory,
  schemaRegistry: SchemaRegistry,
  postAuthChain: RequestHandler[] = [],
): Router {
  const router = Router();

  // P2 middleware order: auth FIRST (front gate), then the per-key rate limiters
  // and safety/PII firewall — which now see a populated req.user.apiKeyId.
  router.use(apiKeyAuth, ...postAuthChain);

  // Create middleware instances
  const dynamicValidation = createDynamicValidationMiddleware(schemaRegistry);

  // Create controller instances
  const modelController = createModelController(modelFactory);
  const modelInfoController = createModelInfoController(modelFactory);
  const modelListController = createModelListController(modelFactory);
  const streamController = createStreamController(modelFactory);

  /**
   * Create dynamic multer middleware based on schema requirements
   * @param modelId - Model identifier
   * @returns Multer middleware or null
   */
  function createDynamicMulterMiddleware(modelId: string) {
    try {
      // Check if the model schema requires file upload
      const schema = schemaRegistry.getSchema(modelId);

      // Check if schema has file-related properties
      const hasFileRequirements = checkSchemaForFileRequirements(schema);

      if (!hasFileRequirements) {
        // No file requirements, return a pass-through middleware
        return (_req: any, _res: any, next: any) => next();
      }

      // Configure multer for file uploads
      const storage = multer.memoryStorage();

      const upload = multer({
        storage,
        limits: {
          fileSize: 10 * 1024 * 1024, // 10MB limit
          files: 5, // Maximum 5 files
        },
        fileFilter: (_req, file, cb) => {
          // Basic file type validation
          const allowedTypes = [
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
            'text/plain',
            'application/pdf',
            'application/json',
          ];

          if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
          } else {
            cb(new Error(`File type ${file.mimetype} is not allowed`));
          }
        },
      });

      return upload.any(); // Accept any number of files with any field name
    } catch (error) {
      // If schema not found, assume no file requirements
      return (_req: any, _res: any, next: any) => next();
    }
  }

  /**
   * Check if schema requires file uploads
   * @param schema - JSON Schema
   * @returns True if file upload is required
   */
  function checkSchemaForFileRequirements(schema: any): boolean {
    if (!schema || typeof schema !== 'object') {
      return false;
    }

    // Check for file-related properties in schema
    const fileKeywords = ['file', 'files', 'upload', 'image', 'document'];

    function checkObject(obj: any): boolean {
      if (typeof obj !== 'object' || obj === null) {
        return false;
      }

      // Check properties
      if (obj.properties) {
        for (const key of Object.keys(obj.properties)) {
          if (fileKeywords.some((keyword) => key.toLowerCase().includes(keyword))) {
            return true;
          }
          if (checkObject(obj.properties[key])) {
            return true;
          }
        }
      }

      // Check required fields
      if (obj.required && Array.isArray(obj.required)) {
        for (const field of obj.required) {
          if (fileKeywords.some((keyword) => field.toLowerCase().includes(keyword))) {
            return true;
          }
        }
      }

      // Check items for arrays
      if (obj.items && checkObject(obj.items)) {
        return true;
      }

      // Check anyOf, oneOf, allOf
      const checkArray = (arr: any[]) => arr.some((item) => checkObject(item));

      if (obj.anyOf && checkArray(obj.anyOf)) return true;
      if (obj.oneOf && checkArray(obj.oneOf)) return true;
      if (obj.allOf && checkArray(obj.allOf)) return true;

      return false;
    }

    return checkObject(schema);
  }

  // Routes

  /**
   * GET /models - List all available models
   */
  router.get('/models', modelListController);

  /**
   * GET /models/:modelId - Get information about a specific model
   */
  router.get('/models/:modelId', rbacModelMiddleware, modelInfoController);

  /**
   * POST /models/:modelId/invoke - Invoke a specific model
   * Applies authentication, dynamic validation, and file upload middleware
   */
  router.post(
    '/models/:modelId/invoke',
    rbacModelMiddleware,
    (req, res, next) => {
      // Apply dynamic multer middleware based on model requirements
      const modelId = req.params['modelId'] || '';
      const multerMiddleware = createDynamicMulterMiddleware(modelId);
      multerMiddleware(req, res, next);
    },
    dynamicValidation,
    modelController,
  );

  /**
   * POST /models/:modelId/stream - Stream model response via SSE
   */
  router.post(
    '/models/:modelId/stream',
    rbacModelMiddleware,
    (req, res, next) => {
      const modelId = req.params['modelId'] || '';
      const multerMiddleware = createDynamicMulterMiddleware(modelId);
      multerMiddleware(req, res, next);
    },
    dynamicValidation,
    streamController,
  );

  return router;
}

/**
 * Create a default model routes instance
 * This should be called after the factory and registry are initialized
 */
export function createDefaultModelRoutes(): Router {
  // This will be set up when the server initializes
  throw new Error(
    'createDefaultModelRoutes() should be called after ModelFactory and SchemaRegistry are initialized',
  );
}
