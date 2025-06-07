/**
 * Simple logging service for Pente3D
 * Provides consistent logging with levels and context
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

export interface LogContext {
  [key: string]: any;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error, context?: LogContext): void;
}

class ConsoleLogger implements Logger {
  private level: LogLevel;
  private isDevelopment: boolean;

  constructor(level: LogLevel = LogLevel.INFO) {
    this.level = level;
    // Check if we're in development mode
    // In production builds, this will be replaced by the bundler
    this.isDevelopment = process.env.NODE_ENV !== 'production';
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.isDevelopment && level >= this.level;
  }

  private formatMessage(level: string, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    return `[${timestamp}] [${level}] ${message}${contextStr}`;
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      // eslint-disable-next-line no-console
      console.debug(this.formatMessage('DEBUG', message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.INFO)) {
      // eslint-disable-next-line no-console
      console.info(this.formatMessage('INFO', message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.WARN)) {
      // eslint-disable-next-line no-console
      console.warn(this.formatMessage('WARN', message, context));
    }
  }

  error(message: string, error?: Error, context?: LogContext): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const errorContext = {
        ...context,
        ...(error && {
          errorName: error.name,
          errorMessage: error.message,
          errorStack: error.stack,
        }),
      };
      // eslint-disable-next-line no-console
      console.error(this.formatMessage('ERROR', message, errorContext));
    }
  }
}

// Singleton logger instance
let loggerInstance: ConsoleLogger | null = null;

export function getLogger(): Logger {
  if (!loggerInstance) {
    const isDev = process.env.NODE_ENV !== 'production';
    loggerInstance = new ConsoleLogger(isDev ? LogLevel.DEBUG : LogLevel.WARN);
  }
  return loggerInstance;
}

export function setLogLevel(level: LogLevel): void {
  const logger = getLogger() as ConsoleLogger;
  logger.setLevel(level);
}

// Convenience export for direct usage
export const logger = getLogger();
