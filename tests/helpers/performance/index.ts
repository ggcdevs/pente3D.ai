/**
 * Performance benchmarking utilities for tests
 * Provides tools to measure and assert performance characteristics
 */

export interface BenchmarkResult {
  name: string;
  samples: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  standardDeviation: number;
  percentile95: number;
  opsPerSecond: number;
}

export interface BenchmarkOptions {
  samples?: number;
  warmup?: number;
  timeout?: number;
  async?: boolean;
}

/**
 * Performance benchmark runner
 */
export class Benchmark {
  private results: number[] = [];
  private name: string;
  private options: Required<BenchmarkOptions>;

  constructor(name: string, options: BenchmarkOptions = {}) {
    this.name = name;
    this.options = {
      samples: options.samples || 100,
      warmup: options.warmup || 10,
      timeout: options.timeout || 30000,
      async: options.async || false,
    };
  }

  /**
   * Run the benchmark
   */
  async run(fn: () => void | Promise<void>): Promise<BenchmarkResult> {
    // Warmup runs
    for (let i = 0; i < this.options.warmup; i++) {
      if (this.options.async) {
        await fn();
      } else {
        fn();
      }
    }

    // Collect samples
    const startTime = Date.now();
    for (let i = 0; i < this.options.samples; i++) {
      if (Date.now() - startTime > this.options.timeout) {
        throw new Error(`Benchmark "${this.name}" timed out after ${this.options.timeout}ms`);
      }

      const start = performance.now();
      
      if (this.options.async) {
        await fn();
      } else {
        fn();
      }
      
      const end = performance.now();
      this.results.push(end - start);
    }

    return this.analyze();
  }

  /**
   * Analyze benchmark results
   */
  private analyze(): BenchmarkResult {
    const sorted = [...this.results].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const mean = sum / sorted.length;
    
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

    const variance = sorted.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / sorted.length;
    const standardDeviation = Math.sqrt(variance);

    const percentile95Index = Math.floor(sorted.length * 0.95);
    const percentile95 = sorted[percentile95Index];

    return {
      name: this.name,
      samples: this.results.length,
      mean,
      median,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      standardDeviation,
      percentile95,
      opsPerSecond: 1000 / mean,
    };
  }
}

/**
 * Benchmark suite for running multiple benchmarks
 */
export class BenchmarkSuite {
  private benchmarks: Map<string, () => void | Promise<void>> = new Map();
  private results: Map<string, BenchmarkResult> = new Map();
  private options: BenchmarkOptions;

  constructor(private name: string, options: BenchmarkOptions = {}) {
    this.options = options;
  }

  /**
   * Add a benchmark to the suite
   */
  add(name: string, fn: () => void | Promise<void>): this {
    this.benchmarks.set(name, fn);
    return this;
  }

  /**
   * Run all benchmarks in the suite
   */
  async run(): Promise<Map<string, BenchmarkResult>> {
    console.log(`Running benchmark suite: ${this.name}`);
    console.log('='.repeat(50));

    for (const [name, fn] of this.benchmarks) {
      const benchmark = new Benchmark(name, this.options);
      const result = await benchmark.run(fn);
      this.results.set(name, result);
      
      console.log(`${name}:`);
      console.log(`  Mean: ${result.mean.toFixed(3)}ms`);
      console.log(`  Ops/sec: ${result.opsPerSecond.toFixed(0)}`);
      console.log(`  Samples: ${result.samples}`);
    }

    console.log('='.repeat(50));
    return this.results;
  }

  /**
   * Compare results between benchmarks
   */
  compare(baseline: string, comparison: string): number {
    const baselineResult = this.results.get(baseline);
    const comparisonResult = this.results.get(comparison);

    if (!baselineResult || !comparisonResult) {
      throw new Error('Both benchmarks must be run before comparison');
    }

    return (comparisonResult.mean - baselineResult.mean) / baselineResult.mean * 100;
  }

  /**
   * Get the fastest benchmark
   */
  getFastest(): [string, BenchmarkResult] | undefined {
    let fastest: [string, BenchmarkResult] | undefined;
    let minMean = Infinity;

    for (const [name, result] of this.results) {
      if (result.mean < minMean) {
        minMean = result.mean;
        fastest = [name, result];
      }
    }

    return fastest;
  }

  /**
   * Get the slowest benchmark
   */
  getSlowest(): [string, BenchmarkResult] | undefined {
    let slowest: [string, BenchmarkResult] | undefined;
    let maxMean = -Infinity;

    for (const [name, result] of this.results) {
      if (result.mean > maxMean) {
        maxMean = result.mean;
        slowest = [name, result];
      }
    }

    return slowest;
  }

  /**
   * Export results as JSON
   */
  toJSON(): Record<string, BenchmarkResult> {
    const results: Record<string, BenchmarkResult> = {};
    for (const [name, result] of this.results) {
      results[name] = result;
    }
    return results;
  }
}

/**
 * Performance measurement utilities
 */
export class PerformanceUtils {
  /**
   * Measure memory usage
   */
  static measureMemory(): { heapUsed: number; heapTotal: number; external: number } {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const usage = process.memoryUsage();
      return {
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        external: usage.external || 0,
      };
    }
    
    // Browser environment - use performance.memory if available
    if (typeof performance !== 'undefined' && (performance as any).memory) {
      const memory = (performance as any).memory;
      return {
        heapUsed: memory.usedJSHeapSize,
        heapTotal: memory.totalJSHeapSize,
        external: 0,
      };
    }

    return { heapUsed: 0, heapTotal: 0, external: 0 };
  }

  /**
   * Format bytes to human readable
   */
  static formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Profile a function's memory usage
   */
  static async profileMemory<T>(
    fn: () => T | Promise<T>
  ): Promise<{ result: T; memoryDelta: number }> {
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    const before = this.measureMemory();
    const result = await fn();
    const after = this.measureMemory();

    return {
      result,
      memoryDelta: after.heapUsed - before.heapUsed,
    };
  }

  /**
   * Create a performance timer
   */
  static createTimer(): {
    start: () => void;
    stop: () => number;
    lap: () => number;
    reset: () => void;
  } {
    let startTime: number | null = null;
    let lastLap: number | null = null;

    return {
      start() {
        startTime = performance.now();
        lastLap = startTime;
      },
      stop() {
        if (!startTime) throw new Error('Timer not started');
        return performance.now() - startTime;
      },
      lap() {
        if (!lastLap) throw new Error('Timer not started');
        const now = performance.now();
        const lapTime = now - lastLap;
        lastLap = now;
        return lapTime;
      },
      reset() {
        startTime = null;
        lastLap = null;
      },
    };
  }
}

/**
 * Performance assertions for tests
 */
export class PerformanceAssertions {
  /**
   * Assert operation completes within time limit
   */
  static async assertCompleteWithin<T>(
    fn: () => T | Promise<T>,
    maxMs: number,
    message?: string
  ): Promise<T> {
    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;

    if (duration > maxMs) {
      throw new Error(
        message || `Operation took ${duration.toFixed(2)}ms, expected less than ${maxMs}ms`
      );
    }

    return result;
  }

  /**
   * Assert operations per second meets minimum
   */
  static async assertOpsPerSecond(
    fn: () => void | Promise<void>,
    minOps: number,
    options: BenchmarkOptions = {}
  ): Promise<void> {
    const benchmark = new Benchmark('ops-test', options);
    const result = await benchmark.run(fn);

    if (result.opsPerSecond < minOps) {
      throw new Error(
        `Operation achieved ${result.opsPerSecond.toFixed(0)} ops/sec, expected at least ${minOps}`
      );
    }
  }

  /**
   * Assert memory usage stays below limit
   */
  static async assertMemoryUsage<T>(
    fn: () => T | Promise<T>,
    maxBytes: number,
    message?: string
  ): Promise<T> {
    const { result, memoryDelta } = await PerformanceUtils.profileMemory(fn);

    if (memoryDelta > maxBytes) {
      throw new Error(
        message || 
        `Memory usage increased by ${PerformanceUtils.formatBytes(memoryDelta)}, ` +
        `expected less than ${PerformanceUtils.formatBytes(maxBytes)}`
      );
    }

    return result;
  }

  /**
   * Assert performance regression
   */
  static assertNoRegression(
    current: BenchmarkResult,
    baseline: BenchmarkResult,
    maxRegressionPercent = 10
  ): void {
    const regressionPercent = ((current.mean - baseline.mean) / baseline.mean) * 100;

    if (regressionPercent > maxRegressionPercent) {
      throw new Error(
        `Performance regression detected: ${regressionPercent.toFixed(1)}% slower ` +
        `(current: ${current.mean.toFixed(3)}ms, baseline: ${baseline.mean.toFixed(3)}ms)`
      );
    }
  }
}

/**
 * Create a benchmark suite with common game benchmarks
 */
export function createGameBenchmarks(options?: BenchmarkOptions): BenchmarkSuite {
  return new BenchmarkSuite('Pente3D Performance', options);
}

// Export convenience functions
export const benchmark = (name: string, options?: BenchmarkOptions) => new Benchmark(name, options);
export const suite = (name: string, options?: BenchmarkOptions) => new BenchmarkSuite(name, options);