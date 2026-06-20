

/**
 * Custom API Error class for handling application-specific errors
 * Extends the native Error class with additional properties for HTTP responses
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly timestamp: string;

  /**
   * Create a new API Error
   * @param statusCode - HTTP status code (default: 500)
   * @param message - Error message (default: 'Internal Server Error')
   * @param isOperational - Whether this is an operational error (default: true)
   */
  constructor(
    statusCode: number = 500,
    message: string = 'Internal Server Error',
    isOperational: boolean = true
  ) {
    super(message);
    
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }

  /**
   * Create a Bad Request error (400)
   * @param message - Error message
   */
  static badRequest(message: string = 'Bad Request'): ApiError {
    return new ApiError(400, message);
  }

  /**
   * Create an Unauthorized error (401)
   * @param message - Error message
   */
  static unauthorized(message: string = 'Unauthorized'): ApiError {
    return new ApiError(401, message);
  }

  /**
   * Create a Forbidden error (403)
   * @param message - Error message
   */
  static forbidden(message: string = 'Forbidden'): ApiError {
    return new ApiError(403, message);
  }

  /**
   * Create a Not Found error (404)
   * @param message - Error message
   */
  static notFound(message: string = 'Not Found'): ApiError {
    return new ApiError(404, message);
  }

  /**
   * Create a Conflict error (409)
   * @param message - Error message
   */
  static conflict(message: string = 'Conflict'): ApiError {
    return new ApiError(409, message);
  }

  /**
   * Create a Validation error (422)
   * @param message - Error message
   */
  static validation(message: string = 'Validation Error'): ApiError {
    return new ApiError(422, message);
  }

  /**
   * Create an Internal Server error (500)
   * @param message - Error message
   */
  static internal(message: string = 'Internal Server Error'): ApiError {
    return new ApiError(500, message);
  }

  /**
   * Create a Not Implemented error (501)
   * @param message - Error message
   */
  static notImplemented(message: string = 'Not Implemented'): ApiError {
    return new ApiError(501, message);
  }

  /**
   * Create a Service Unavailable error (503)
   * @param message - Error message
   */
  static serviceUnavailable(message: string = 'Service Unavailable'): ApiError {
    return new ApiError(503, message);
  }

  /**
   * Convert the error to a JSON-serializable object
   * @param includeStack - Whether to include the stack trace (default: false in production)
   */
  toJSON(includeStack: boolean = process.env['NODE_ENV'] === 'development') {
    const errorObject: any = {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      timestamp: this.timestamp,
      isOperational: this.isOperational
    };

    if (includeStack) {
      errorObject.stack = this.stack;
    }

    return errorObject;
  }
}
