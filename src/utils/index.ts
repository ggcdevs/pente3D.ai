export { EventEmitter } from './EventEmitter';
export { downloadJSON, uploadJSON } from './fileIO';
export { PerformanceMonitor } from './PerformanceMonitor';
export type { PerformanceMetrics, PerformanceThresholds } from './PerformanceMonitor';
export { ObjectPool } from './ObjectPool';
export type { Poolable } from './ObjectPool';
export { AccessibilityManager } from './AccessibilityManager';
export type { AccessibilityOptions, AccessibilityEvent } from './AccessibilityManager';
export { logger, getLogger, setLogLevel, LogLevel } from './logger';
export type { Logger, LogContext } from './logger';
export {
  Pente3DError,
  GameRuleError,
  InvalidMoveError,
  InvalidStateError,
  NetworkError,
  ConnectionError,
  FileOperationError,
  SerializationError,
  ValidationError,
  RenderingError,
  isPente3DError,
  hasErrorMessage,
  getErrorMessage,
  createErrorResponse,
  type ErrorResponse,
} from './errors';
