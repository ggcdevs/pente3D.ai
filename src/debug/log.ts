/**
 * Namespaced, leveled debug logger.
 *
 * Levels: trace < debug < info < warn < error.
 * Namespaces are colon-delimited subsystem tags, e.g. `render:scene`, `core:capture`.
 *
 * Enabling streams (glob patterns, comma-separated), in priority order:
 *   1. URL param `?debug=render:*,core:capture`
 *   2. localStorage key `pente:debug`
 *
 * A pattern matches a namespace via `*` wildcards (`render:*` matches `render:scene`).
 * `warn` and `error` always emit regardless of enabled patterns, so failures are never
 * silently swallowed. This module has no DOM/render/net imports and is safe to use anywhere.
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

/** Compile a comma-separated glob spec into namespace matchers. */
function compilePatterns(spec: string): RegExp[] {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const escaped = s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      return new RegExp(`^${escaped}$`);
    });
}

function readSpec(): string {
  // URL param wins over localStorage.
  try {
    if (typeof globalThis !== 'undefined' && 'location' in globalThis) {
      const loc = (globalThis as { location?: { search?: string } }).location;
      if (loc?.search) {
        const params = new URLSearchParams(loc.search);
        const fromUrl = params.get('debug');
        if (fromUrl !== null) return fromUrl;
      }
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      const ls = (globalThis as { localStorage?: Storage }).localStorage;
      const fromLs = ls?.getItem('pente:debug');
      if (fromLs !== null && fromLs !== undefined) return fromLs;
    }
  } catch {
    /* ignore */
  }
  return '';
}

let cachedPatterns: RegExp[] | null = null;

function patterns(): RegExp[] {
  if (cachedPatterns === null) {
    cachedPatterns = compilePatterns(readSpec());
  }
  return cachedPatterns;
}

/** Re-read the enable spec (e.g. after localStorage changes). Exposed for tests/tools. */
export function refreshDebugSpec(): void {
  cachedPatterns = null;
}

/** Set the enable spec directly (patterns take effect immediately). */
export function setDebugSpec(spec: string): void {
  cachedPatterns = compilePatterns(spec);
}

function isEnabled(namespace: string, level: LogLevel): boolean {
  // warn/error are always visible.
  if (LEVEL_ORDER[level] >= LEVEL_ORDER.warn) return true;
  return patterns().some((re) => re.test(namespace));
}

export interface Logger {
  trace(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

const CONSOLE_METHOD: Record<LogLevel, 'debug' | 'info' | 'warn' | 'error'> = {
  trace: 'debug',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

function emit(namespace: string, level: LogLevel, args: unknown[]): void {
  if (!isEnabled(namespace, level)) return;
  const method = CONSOLE_METHOD[level];
  console[method](`[${level}] ${namespace}`, ...args);
}

/** Create a logger bound to a namespace, e.g. `createLogger('render:scene')`. */
export function createLogger(namespace: string): Logger {
  return {
    trace: (...a) => emit(namespace, 'trace', a),
    debug: (...a) => emit(namespace, 'debug', a),
    info: (...a) => emit(namespace, 'info', a),
    warn: (...a) => emit(namespace, 'warn', a),
    error: (...a) => emit(namespace, 'error', a),
  };
}
