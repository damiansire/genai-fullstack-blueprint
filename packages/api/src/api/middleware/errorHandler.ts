import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../core/ApiError.js';
import { getSystemErrorName } from 'node:util';
import { getTraceId } from '../../core/async-context.js';
import { logger } from '../../core/logger.js';
import { config } from '../../core/config.js';

/**
 * Global error handler middleware for Express
 * Handles both ApiError instances and generic errors
 * @param err - Error object
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export function errorHandler(
  err: Error | ApiError,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const traceId = getTraceId();

  // Log the error for debugging using structured logger
  logger.error(
    err.message,
    {
      url: req.url,
      method: req.method,
      userAgent: req.get('User-Agent'),
      ip: req.ip || req.connection.remoteAddress,
      traceId,
    },
    err,
  );

  // Handle ApiError instances
  if (err instanceof ApiError) {
    const errorResponse = {
      error: {
        traceId,
        name: err.name,
        message: err.message,
        statusCode: err.statusCode,
        timestamp: err.timestamp,
        path: req.path,
        method: req.method,
        ...(config.isDevelopment && { stack: err.stack }),
      },
    };

    res.status(err.statusCode).json(errorResponse);
    return;
  }

  // Handle validation errors from express-validator or similar libraries
  if (err.name === 'ValidationError') {
    const errorResponse = {
      error: {
        traceId,
        name: 'ValidationError',
        message: err.message,
        statusCode: 422,
        timestamp: new Date().toISOString(),
        path: req.path,
        method: req.method,
      },
    };

    res.status(422).json(errorResponse);
    return;
  }

  // Handle JSON parsing errors
  if (err instanceof SyntaxError && 'body' in err) {
    const errorResponse = {
      error: {
        traceId,
        name: 'SyntaxError',
        message: 'Invalid JSON in request body',
        statusCode: 400,
        timestamp: new Date().toISOString(),
        path: req.path,
        method: req.method,
      },
    };

    res.status(400).json(errorResponse);
    return;
  }

  // Handle multer errors (file upload errors)
  if (err.name === 'MulterError') {
    const errorResponse = {
      error: {
        traceId,
        name: 'MulterError',
        message: err.message,
        statusCode: 400,
        timestamp: new Date().toISOString(),
        path: req.path,
        method: req.method,
      },
    };

    res.status(400).json(errorResponse);
    return;
  }

  // Handle Node.js System Errors and generic errors
  // Stability: 2 - Stable (node:errors)
  // System errors wrap OS system calls (e.g. read, open). Note that node.js links to Unix man pages for these underlying behaviors.
  const isSystemError = err !== null && typeof err === 'object' && 'code' in err;

  if (isSystemError) {
    const sysErr = err as any;
    const sysErrorName =
      typeof sysErr.code === 'number' ? getSystemErrorName(sysErr.code) : sysErr.code;
    logger.error(
      `Node.js System Error [${sysErrorName || sysErr.code}]`,
      {
        syscall: sysErr.syscall, // Directly maps to Unix system calls (see related man pages)
        path: sysErr.path,
        address: sysErr.address,
        port: sysErr.port,
        traceId,
      },
      sysErr,
    );
  }

  const errorResponse = {
    error: {
      traceId,
      name: isSystemError ? 'SystemError' : 'InternalServerError',
      code: isSystemError ? (err as any).code : undefined,
      message: config.isDevelopment ? err.message : 'Internal Server Error',
      statusCode: 500,
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      ...(config.isDevelopment && { stack: err.stack }),
    },
  };

  res.status(500).json(errorResponse);
}

/**
 * Async error wrapper utility
 * Wraps async route handlers to catch and forward errors to the error handler
 * @param fn - Async function to wrap
 * @returns Wrapped function that catches errors
 */
export function asyncHandler(fn: Function) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 404 handler middleware
 * Handles requests to non-existent routes
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  const error = ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`);
  next(error);
}
