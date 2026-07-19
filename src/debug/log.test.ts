import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLogger, setDebugSpec, refreshDebugSpec } from './log.ts';

afterEach(() => {
  vi.restoreAllMocks();
  refreshDebugSpec();
});

describe('debug logger', () => {
  it('suppresses trace/debug/info when namespace is not enabled', () => {
    setDebugSpec('');
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const log = createLogger('render:scene');
    log.trace('t');
    log.debug('d');
    log.info('i');
    expect(debug).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it('emits trace/debug/info when namespace matches a wildcard pattern', () => {
    setDebugSpec('render:*');
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const log = createLogger('render:scene');
    log.debug('hello');
    log.info('world');
    expect(debug).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0]?.[0]).toContain('render:scene');
  });

  it('matches an exact namespace', () => {
    setDebugSpec('core:capture');
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    createLogger('core:capture').debug('x');
    createLogger('core:win').debug('y');
    expect(debug).toHaveBeenCalledOnce();
  });

  it('always emits warn and error regardless of enabled patterns', () => {
    setDebugSpec('');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = createLogger('net:sync');
    log.warn('careful');
    log.error('boom');
    expect(warn).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
  });
});
