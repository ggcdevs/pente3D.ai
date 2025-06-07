/**
 * Custom error classes for Pente3D
 * Provides structured error handling with proper types
 */

/**
 * Base error class for all Pente3D errors
 */
export class Pente3DError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    
    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error thrown when game rules are violated
 */
export class GameRuleError extends Pente3DError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'GAME_RULE_ERROR', context);
  }
}

/**
 * Error thrown when an invalid move is attempted
 */
export class InvalidMoveError extends GameRuleError {
  constructor(message: string, position?: { x: number; y: number; z: number }) {
    super(message, { position });
  }
}

/**
 * Error thrown when game state is invalid
 */
export class InvalidStateError extends Pente3DError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'INVALID_STATE_ERROR', context);
  }
}

/**
 * Error thrown during network operations
 */
export class NetworkError extends Pente3DError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'NETWORK_ERROR', context);
  }
}

/**
 * Error thrown when network connection fails
 */
export class ConnectionError extends NetworkError {
  constructor(message: string, peerId?: string) {
    super(message, { peerId });
  }
}

/**
 * Error thrown during file operations
 */
export class FileOperationError extends Pente3DError {
  constructor(message: string, operation: 'read' | 'write' | 'parse', filename?: string) {
    super(message, 'FILE_OPERATION_ERROR', { operation, filename });
  }
}

/**
 * Error thrown during JSON parsing/serialization
 */
export class SerializationError extends Pente3DError {
  constructor(message: string, objectType: string, context?: Record<string, unknown>) {
    super(message, 'SERIALIZATION_ERROR', { objectType, ...context });
  }
}

/**
 * Error thrown when validation fails
 */
export class ValidationError extends Pente3DError {
  constructor(message: string, field: string, value?: unknown) {
    super(message, 'VALIDATION_ERROR', { field, value });
  }
}

/**
 * Error thrown during rendering operations
 */
export class RenderingError extends Pente3DError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'RENDERING_ERROR', context);
  }
}

/**
 * Type guard to check if an error is a Pente3DError
 */
export function isPente3DError(error: unknown): error is Pente3DError {
  return error instanceof Pente3DError;
}

/**
 * Type guard to check if an error has a message property
 */
export function hasErrorMessage(error: unknown): error is { message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as Record<string, unknown>).message === 'string'
  );
}

/**
 * Safely get error message from unknown error type
 */
export function getErrorMessage(error: unknown): string {
  if (hasErrorMessage(error)) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error occurred';
}

/**
 * Create a standardized error response
 */
export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    context?: Record<string, unknown>;
  };
}

export function createErrorResponse(error: unknown): ErrorResponse {
  if (isPente3DError(error)) {
    return {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        context: error.context,
      },
    };
  }

  return {
    success: false,
    error: {
      code: 'UNKNOWN_ERROR',
      message: getErrorMessage(error),
    },
  };
}