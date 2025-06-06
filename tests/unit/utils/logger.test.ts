import { logger, LogLevel, setLogLevel, getLogger } from '@/utils/logger';

describe('Logger', () => {
  // Store original console methods
  const originalConsole = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error
  };

  // Create spies
  const consoleSpy = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };

  beforeEach(() => {
    // Replace console methods with spies
    console.debug = consoleSpy.debug;
    console.info = consoleSpy.info;
    console.warn = consoleSpy.warn;
    console.error = consoleSpy.error;

    // Reset spies
    jest.clearAllMocks();

    // Set to debug level for testing
    setLogLevel(LogLevel.DEBUG);
  });

  afterEach(() => {
    // Restore original console methods
    console.debug = originalConsole.debug;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });

  describe('Logging Methods', () => {
    it('should log debug messages', () => {
      logger.debug('Debug message');
      expect(consoleSpy.debug).toHaveBeenCalledTimes(1);
      expect(consoleSpy.debug).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG] Debug message')
      );
    });

    it('should log info messages', () => {
      logger.info('Info message');
      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] Info message')
      );
    });

    it('should log warn messages', () => {
      logger.warn('Warning message');
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpy.warn).toHaveBeenCalledWith(
        expect.stringContaining('[WARN] Warning message')
      );
    });

    it('should log error messages', () => {
      const error = new Error('Test error');
      logger.error('Error message', error);
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] Error message')
      );
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('Test error')
      );
    });
  });

  describe('Context Logging', () => {
    it('should include context in log messages', () => {
      const context = { userId: '123', action: 'test' };
      logger.info('User action', context);
      
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining(JSON.stringify(context))
      );
    });

    it('should include error details in error logs', () => {
      const error = new Error('Test error');
      const context = { component: 'TestComponent' };
      logger.error('Component error', error, context);
      
      const callArg = consoleSpy.error.mock.calls[0][0];
      expect(callArg).toContain('errorName');
      expect(callArg).toContain('errorMessage');
      expect(callArg).toContain('component');
    });
  });

  describe('Log Levels', () => {
    it('should respect log level settings', () => {
      // Set to WARN level
      setLogLevel(LogLevel.WARN);

      logger.debug('Debug - should not appear');
      logger.info('Info - should not appear');
      logger.warn('Warning - should appear');
      logger.error('Error - should appear');

      expect(consoleSpy.debug).not.toHaveBeenCalled();
      expect(consoleSpy.info).not.toHaveBeenCalled();
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    });

    it('should not log anything when level is NONE', () => {
      setLogLevel(LogLevel.NONE);

      logger.debug('Debug');
      logger.info('Info');
      logger.warn('Warning');
      logger.error('Error');

      expect(consoleSpy.debug).not.toHaveBeenCalled();
      expect(consoleSpy.info).not.toHaveBeenCalled();
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.error).not.toHaveBeenCalled();
    });
  });

  describe('Message Formatting', () => {
    it('should include timestamp in log messages', () => {
      logger.info('Test message');
      
      const callArg = consoleSpy.info.mock.calls[0][0];
      // Check for ISO timestamp format
      expect(callArg).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    });

    it('should format messages consistently', () => {
      logger.info('Test message');
      
      const callArg = consoleSpy.info.mock.calls[0][0];
      expect(callArg).toMatch(/\[.*\] \[INFO\] Test message/);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return the same logger instance', () => {
      const logger1 = getLogger();
      const logger2 = getLogger();
      
      expect(logger1).toBe(logger2);
      expect(logger1).toBe(logger);
    });
  });
});