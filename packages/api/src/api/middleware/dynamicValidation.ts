import { Request, Response, NextFunction } from 'express';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { SchemaRegistry } from '../../infrastructure/ai/registry.js';
import { ApiError } from '../../core/ApiError.js';
import { logger } from '../../core/logger.js';

/**
 * Interface for validation error details
 */
interface ValidationErrorDetail {
  field: string;
  message: string;
  value?: any;
  allowedValues?: any[];
}

/**
 * Interface for validation result
 */
interface ValidationResult {
  isValid: boolean;
  errors: ValidationErrorDetail[];
}

/**
 * Create a dynamic validation middleware factory
 * @param schemaRegistry - Instance of SchemaRegistry to get schemas from
 * @returns Express middleware function
 */
export function createDynamicValidationMiddleware(schemaRegistry: SchemaRegistry) {
  // Initialize AJV with formats support
  const ajv = new Ajv({
    allErrors: true,
    verbose: true,
    strict: false,
    removeAdditional: false
  });

  // Add common JSON Schema formats (email, date, uri, etc.)
  addFormats(ajv);

  // Custom error messages for better user experience
  ajv.addKeyword({
    keyword: 'errorMessage',
    type: 'object',
    schemaType: 'object',
    compile: (_schema: any) => (_data: any) => {
      // This is handled by the custom error formatting below
      return true;
    }
  });

  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Extract modelId from request parameters
      const modelId = req.params['modelId'];

      if (!modelId) {
        throw ApiError.badRequest('Model ID is required in request parameters');
      }

      // Get schema from registry
      let configSchema: any;
      try {
        configSchema = schemaRegistry.getSchema(modelId);
      } catch (error) {
        throw ApiError.notFound(`No validation schema found for model: ${modelId}`);
      }

      // Validate request body against schema
      const validationResult = validateRequestBody(req.body, configSchema, ajv);

      if (!validationResult.isValid) {
        const errorResponse = {
          error: {
            name: 'ValidationError',
            message: 'Request body validation failed',
            statusCode: 400,
            timestamp: new Date().toISOString(),
            path: req.path,
            method: req.method,
            details: validationResult.errors
          }
        };

        logger.warn(`❌ Validation failed for model ${modelId}`, {
          errors: validationResult.errors,
          body: req.body,
          timestamp: new Date().toISOString()
        });

        res.status(400).json(errorResponse);
        return;
      }

      // Validation successful, continue to next middleware
      logger.info(`✅ Validation passed for model ${modelId}`);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Validate request body against JSON schema using AJV
 * @param body - Request body to validate
 * @param schema - JSON Schema to validate against
 * @param ajv - AJV instance
 * @returns Validation result with detailed errors
 */
function validateRequestBody(body: any, schema: any, ajv: Ajv): ValidationResult {
  // Compile the schema
  const validate = ajv.compile(schema);

  // Perform validation
  const isValid = validate(body);

  if (isValid) {
    return {
      isValid: true,
      errors: []
    };
  }

  // Format validation errors for better user experience
  const errors: ValidationErrorDetail[] = validate.errors?.map(error => {
    const field = error.instancePath ? error.instancePath.substring(1) : error.schemaPath;
    
    const allowedValues = getAllowedValues(error);
    return {
      field: field || 'root',
      message: formatErrorMessage(error),
      value: error.data,
      ...(allowedValues !== undefined ? { allowedValues } : {})
    };
  }) || [];

  return {
    isValid: false,
    errors
  };
}

/**
 * Format AJV error message for better user experience
 * @param error - AJV validation error
 * @returns Formatted error message
 */
function formatErrorMessage(error: any): string {
  const { keyword, params, message } = error;

  switch (keyword) {
    case 'required':
      return `Field '${params.missingProperty}' is required`;
    
    case 'type':
      return `Field '${error.instancePath?.substring(1) || 'root'}' must be of type ${params.type}`;
    
    case 'format':
      return `Field '${error.instancePath?.substring(1) || 'root'}' must be a valid ${params.format}`;
    
    case 'minimum':
      return `Field '${error.instancePath?.substring(1) || 'root'}' must be at least ${params.limit}`;
    
    case 'maximum':
      return `Field '${error.instancePath?.substring(1) || 'root'}' must be at most ${params.limit}`;
    
    case 'minLength':
      return `Field '${error.instancePath?.substring(1) || 'root'}' must be at least ${params.limit} characters long`;
    
    case 'maxLength':
      return `Field '${error.instancePath?.substring(1) || 'root'}' must be at most ${params.limit} characters long`;
    
    case 'pattern':
      return `Field '${error.instancePath?.substring(1) || 'root'}' does not match the required pattern`;
    
    case 'enum':
      return `Field '${error.instancePath?.substring(1) || 'root'}' must be one of: ${params.allowedValues.join(', ')}`;
    
    case 'additionalProperties':
      return `Field '${error.instancePath?.substring(1) || 'root'}' contains additional properties not allowed in schema`;
    
    case 'uniqueItems':
      return `Field '${error.instancePath?.substring(1) || 'root'}' must contain unique items`;
    
    default:
      return message || `Validation failed for field '${error.instancePath?.substring(1) || 'root'}'`;
  }
}

/**
 * Get allowed values for enum validation errors
 * @param error - AJV validation error
 * @returns Array of allowed values or undefined
 */
function getAllowedValues(error: any): any[] | undefined {
  if (error.keyword === 'enum' && error.params?.allowedValues) {
    return error.params.allowedValues;
  }
  return undefined;
}

/**
 * Middleware for validating specific fields in request body
 * @param fieldPath - Dot notation path to the field to validate
 * @param schema - JSON Schema for the specific field
 * @returns Express middleware function
 */
export function validateField(fieldPath: string, schema: any) {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);

  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const fieldValue = getNestedValue(req.body, fieldPath);
      const validate = ajv.compile(schema);
      const isValid = validate(fieldValue);

      if (!isValid) {
        throw ApiError.validation(`Validation failed for field '${fieldPath}'`);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Get nested value from object using dot notation
 * @param obj - Object to get value from
 * @param path - Dot notation path
 * @returns Value at the specified path
 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Middleware for validating query parameters
 * @param schema - JSON Schema for query parameters
 * @returns Express middleware function
 */
export function validateQuery(schema: any) {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);

  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const validate = ajv.compile(schema);
      const isValid = validate(req.query);

      if (!isValid) {
        throw ApiError.validation('Query parameters validation failed');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
