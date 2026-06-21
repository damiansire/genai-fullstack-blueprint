import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { ApiError } from '../../core/ApiError.js';
import { logger } from '../../core/logger.js';

/**
 * Interface for API key validation result
 */
interface ApiKeyValidationResult {
  isValid: boolean;
  keyId?: string;
  permissions?: string[];
}

/**
 * Derive the access tier from the API key's permissions. A key carrying the
 * `premium` permission resolves to the `premium` tier; everything else is `free`.
 * This is the real identity source for `req.user.tier` consumed by `rbac.ts`.
 */
function tierFromPermissions(permissions: string[] | undefined): 'free' | 'premium' {
  return permissions?.includes('premium') ? 'premium' : 'free';
}

/**
 * Middleware for API key authentication
 * Validates the X-API-Key header against a list of valid keys from environment variables
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export function apiKeyAuth(req: Request, _res: Response, next: NextFunction): void {
  try {
    // Extract API key from header
    const apiKey = req.headers['x-api-key'] as string;

    // Check if API key is present
    if (!apiKey) {
      throw ApiError.unauthorized('API key is required. Please provide X-API-Key header.');
    }

    // Validate the API key
    const validation = validateApiKey(apiKey);
    
    if (!validation.isValid) {
      throw ApiError.unauthorized('Invalid API key provided.');
    }

    // Add API key information to request object for use in controllers
    req.user = {
      ...(validation.keyId ? { apiKeyId: validation.keyId } : {}),
      ...(validation.permissions ? { permissions: validation.permissions } : { permissions: [] }),
      tier: tierFromPermissions(validation.permissions),
      authenticated: true
    };

    // Log successful authentication (optional, for monitoring)
    logger.info(`✅ API key authenticated: ${validation.keyId} - ${req.method} ${req.path}`);

    next();
  } catch (error) {
    // Log failed authentication attempt
    logger.warn(`❌ API key authentication failed: ${req.ip} - ${req.method} ${req.path}`, {
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });

    next(error);
  }
}
/**
 * Validate API key against environment variables
 * @param apiKey - The API key to validate
 * @returns Validation result with key information
 */
function validateApiKey(apiKey: string): ApiKeyValidationResult {
  // Get valid API keys from environment variables
  const validKeys = getValidApiKeys();
  
  // Check if the provided key exists in the valid keys using constant-time comparison
  const apiKeyBuffer = Buffer.from(apiKey);
  
  const keyEntry = validKeys.find(entry => {
    const entryKeyBuffer = Buffer.from(entry.key);
    // timingSafeEqual requires buffers of the same length
    if (entryKeyBuffer.length !== apiKeyBuffer.length) {
      return false;
    }
    return timingSafeEqual(entryKeyBuffer, apiKeyBuffer);
  });
  
  if (!keyEntry) {
    return { isValid: false };
  }

  return {
    isValid: true,
    keyId: keyEntry.id,
    permissions: keyEntry.permissions
  };
}

/**
 * Get valid API keys from environment variables
 * @returns Array of valid API key entries
 */
function getValidApiKeys(): Array<{ id: string; key: string; permissions: string[] }> {
  const validKeys: Array<{ id: string; key: string; permissions: string[] }> = [];

  // Parse API keys from environment variables
  // Format: API_KEY_1=key1:permissions, API_KEY_2=key2:permissions
  const envKeys = Object.keys(process.env).filter(key => key.startsWith('API_KEY_'));
  
  for (const envKey of envKeys) {
    const keyValue = process.env[envKey];
    if (!keyValue) continue;

    // Parse key and permissions (format: "key:permission1,permission2")
    const [key, permissionsStr] = keyValue.split(':');
    
    // Skip if key is undefined
    if (!key) continue;
    
    const permissions = permissionsStr ? permissionsStr.split(',').map(p => p.trim()) : ['read'];
    
    validKeys.push({
      id: envKey,
      key: key.trim(),
      permissions
    });
  }

  // Fallback to a default API key if no keys are configured
  if (validKeys.length === 0) {
    const defaultKey = process.env['DEFAULT_API_KEY'] || 'default-key-change-in-production';
    validKeys.push({
      id: 'default',
      key: defaultKey,
      permissions: ['read', 'write']
    });
    
    logger.warn('⚠️  No API keys configured in environment variables. Using default key. This is not recommended for production.');
  }

  return validKeys;
}

/**
 * Optional middleware for checking specific permissions
 * @param requiredPermissions - Array of required permissions
 * @returns Middleware function
 */
export function requirePermissions(requiredPermissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (!req.user || !req.user.permissions) {
        throw ApiError.unauthorized('User permissions not found.');
      }

      const userPermissions = req.user.permissions;
      const hasRequiredPermissions = requiredPermissions.every(permission => 
        userPermissions.includes(permission)
      );

      if (!hasRequiredPermissions) {
        throw ApiError.forbidden(`Insufficient permissions. Required: ${requiredPermissions.join(', ')}`);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware for optional API key authentication
 * Similar to apiKeyAuth but doesn't throw error if key is missing
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export function optionalApiKeyAuth(req: Request, _res: Response, next: NextFunction): void {
  try {
    const apiKey = req.headers['x-api-key'] as string;

    if (apiKey) {
      const validation = validateApiKey(apiKey);
      
      if (validation.isValid) {
        req.user = {
          ...(validation.keyId ? { apiKeyId: validation.keyId } : {}),
          ...(validation.permissions ? { permissions: validation.permissions } : { permissions: [] }),
          tier: tierFromPermissions(validation.permissions),
          authenticated: true
        };
      } else {
        req.user = {
          authenticated: false
        };
      }
    } else {
      req.user = {
        authenticated: false
      };
    }

    next();
  } catch (error) {
    // For optional auth, we don't throw errors, just set unauthenticated
    req.user = {
      authenticated: false
    };
    next();
  }
}

// Extend Express Request interface to include user information
declare global {
  namespace Express {
    interface Request {
      user?: {
        apiKeyId?: string;
        permissions?: string[];
        tier?: 'free' | 'premium';
        authenticated: boolean;
      };
    }
  }
}
