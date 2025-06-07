/**
 * Advanced mock utilities for sophisticated testing scenarios
 */

import { jest } from '@jest/globals';
import type { NetworkManager } from '@/network';
import type { Game, Board, Player, Move } from '@/core';
import type { InputHandler } from '@/ui';
import { EventEmitter } from '@/utils';

/**
 * Mock builder for creating configurable mocks
 */
export class MockBuilder<T> {
  private implementation: Partial<T> = {};
  private spies: Map<string, jest.Mock> = new Map();

  /**
   * Set a property value
   */
  withProperty<K extends keyof T>(key: K, value: T[K]): this {
    this.implementation[key] = value;
    return this;
  }

  /**
   * Set a method implementation
   */
  withMethod<K extends keyof T>(
    key: K,
    implementation: T[K] extends (...args: any[]) => any ? T[K] : never
  ): this {
    const spy = jest.fn(implementation as any);
    this.implementation[key] = spy as any;
    this.spies.set(key as string, spy);
    return this;
  }

  /**
   * Set a method that returns a value
   */
  withReturn<K extends keyof T>(key: K, returnValue: any): this {
    const spy = jest.fn().mockReturnValue(returnValue);
    this.implementation[key] = spy as any;
    this.spies.set(key as string, spy);
    return this;
  }

  /**
   * Set a method that returns a promise
   */
  withResolve<K extends keyof T>(key: K, resolveValue: any): this {
    const spy = jest.fn().mockResolvedValue(resolveValue);
    this.implementation[key] = spy as any;
    this.spies.set(key as string, spy);
    return this;
  }

  /**
   * Set a method that throws an error
   */
  withThrow<K extends keyof T>(key: K, error: Error | string): this {
    const spy = jest.fn().mockImplementation(() => {
      throw typeof error === 'string' ? new Error(error) : error;
    });
    this.implementation[key] = spy as any;
    this.spies.set(key as string, spy);
    return this;
  }

  /**
   * Build the mock
   */
  build(): jest.Mocked<T> & { _spies: Map<string, jest.Mock> } {
    const mock = this.implementation as any;
    mock._spies = this.spies;
    return mock;
  }
}

/**
 * Stateful mock for NetworkManager that simulates real behavior
 */
export class StatefulNetworkManagerMock implements Partial<NetworkManager> {
  private eventEmitter = new EventEmitter();
  private connectionState: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
  private gameCode?: string;
  private isHost = false;
  private moves: Move[] = [];
  private latency = 50;
  private playerColor?: 'black' | 'white';

  // Jest spies for tracking calls
  hostGame = jest.fn(async (): Promise<string> => {
    this.connectionState = 'connecting';
    await this.simulateDelay();
    this.connectionState = 'connected';
    this.isHost = true;
    this.gameCode = this.generateGameCode();
    this.playerColor = 'black';
    this.eventEmitter.emit('connection', { connected: true });
    return this.gameCode;
  });

  joinGame = jest.fn(async (code: string): Promise<void> => {
    this.connectionState = 'connecting';
    await this.simulateDelay();
    
    if (code.length !== 8) {
      this.connectionState = 'error';
      throw new Error('Invalid game code');
    }
    
    this.connectionState = 'connected';
    this.gameCode = code;
    this.isHost = false;
    this.playerColor = 'white';
    this.eventEmitter.emit('connection', { connected: true });
  });

  sendMove = jest.fn((move: Move): boolean => {
    if (this.connectionState !== 'connected') return false;
    
    this.moves.push(move);
    
    // Simulate network delay before opponent receives
    setTimeout(() => {
      this.eventEmitter.emit('move', move);
    }, this.latency);
    
    return true;
  });

  getStatus = jest.fn(() => this.connectionState);

  getConnectionInfo = jest.fn(() => ({
    peerId: this.isHost ? 'host-peer' : 'client-peer',
    gameCode: this.gameCode || '',
    isHost: this.isHost,
    status: this.connectionState,
    lastActivity: Date.now(),
    latency: this.latency,
    playerColor: this.playerColor,
    opponentConnected: this.connectionState === 'connected',
  }));

  disconnect = jest.fn(() => {
    this.connectionState = 'disconnected';
    this.gameCode = undefined;
    this.isHost = false;
    this.moves = [];
    this.playerColor = undefined;
    this.eventEmitter.emit('connection', { connected: false });
  });

  // EventEmitter methods
  on = jest.fn((event: string, handler: Function) => {
    this.eventEmitter.on(event, handler);
  });

  off = jest.fn((event: string, handler: Function) => {
    this.eventEmitter.off(event, handler);
  });

  emit = jest.fn((event: string, data?: any) => {
    this.eventEmitter.emit(event, data);
  });

  // Test helpers
  simulateOpponentMove(move: Move): void {
    this.eventEmitter.emit('move', move);
  }

  simulateDisconnect(): void {
    this.connectionState = 'disconnected';
    this.eventEmitter.emit('connection', { connected: false });
  }

  setLatency(ms: number): void {
    this.latency = ms;
  }

  private async simulateDelay(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, this.latency));
  }

  private generateGameCode(): string {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  }
}

/**
 * Spy factory for creating spies with predefined behaviors
 */
export class SpyFactory {
  /**
   * Create a spy that records calls and can be configured
   */
  static createConfigurableSpy<T extends (...args: any[]) => any>(
    name: string,
    defaultImpl?: T
  ): jest.Mock<T> & {
    configure: (config: {
      returnValue?: ReturnType<T>;
      implementation?: T;
      throwError?: Error | string;
      callThrough?: boolean;
    }) => void;
    getCalls: () => Parameters<T>[];
    reset: () => void;
  } {
    let currentConfig: any = {};
    const calls: Parameters<T>[] = [];

    const spy = jest.fn((...args: Parameters<T>) => {
      calls.push(args);

      if (currentConfig.throwError) {
        throw typeof currentConfig.throwError === 'string' 
          ? new Error(currentConfig.throwError)
          : currentConfig.throwError;
      }

      if (currentConfig.implementation) {
        return currentConfig.implementation(...args);
      }

      if (currentConfig.callThrough && defaultImpl) {
        return defaultImpl(...args);
      }

      return currentConfig.returnValue;
    }) as any;

    spy.configure = (config: any) => {
      currentConfig = { ...currentConfig, ...config };
    };

    spy.getCalls = () => [...calls];

    spy.reset = () => {
      calls.length = 0;
      spy.mockClear();
    };

    Object.defineProperty(spy, 'name', { value: name });

    return spy;
  }

  /**
   * Create a spy that simulates async behavior
   */
  static createAsyncSpy<T>(
    name: string,
    options: {
      delay?: number;
      rejectAfter?: number;
      resolveWith?: T;
      rejectWith?: Error | string;
    } = {}
  ): jest.Mock<Promise<T>> {
    return jest.fn(async () => {
      const delay = options.delay || 0;
      
      if (options.rejectAfter !== undefined && Date.now() > options.rejectAfter) {
        throw typeof options.rejectWith === 'string' 
          ? new Error(options.rejectWith)
          : options.rejectWith || new Error('Async operation failed');
      }

      await new Promise(resolve => setTimeout(resolve, delay));
      
      return options.resolveWith as T;
    });
  }

  /**
   * Create a spy that tracks state changes
   */
  static createStateSpy<S>(initialState: S): {
    spy: jest.Mock;
    getState: () => S;
    setState: (state: S) => void;
    getStateHistory: () => S[];
  } {
    let currentState = initialState;
    const stateHistory: S[] = [initialState];

    const spy = jest.fn((newState?: S) => {
      if (newState !== undefined) {
        currentState = newState;
        stateHistory.push(newState);
      }
      return currentState;
    });

    return {
      spy,
      getState: () => currentState,
      setState: (state: S) => {
        currentState = state;
        stateHistory.push(state);
      },
      getStateHistory: () => [...stateHistory],
    };
  }
}

/**
 * Mock WebGL context with validation
 */
export class ValidatingWebGLMock {
  private state = {
    clearColor: [0, 0, 0, 1],
    viewport: [0, 0, 800, 600],
    enabledCapabilities: new Set<number>(),
    currentProgram: null as any,
    boundBuffers: new Map<number, any>(),
    boundTextures: new Map<number, any>(),
  };

  clearColor = jest.fn((r: number, g: number, b: number, a: number) => {
    this.validateColorValue(r, g, b, a);
    this.state.clearColor = [r, g, b, a];
  });

  clear = jest.fn((mask: number) => {
    if (typeof mask !== 'number') {
      throw new Error('Invalid clear mask');
    }
  });

  enable = jest.fn((cap: number) => {
    this.state.enabledCapabilities.add(cap);
  });

  disable = jest.fn((cap: number) => {
    this.state.enabledCapabilities.delete(cap);
  });

  viewport = jest.fn((x: number, y: number, width: number, height: number) => {
    if (width <= 0 || height <= 0) {
      throw new Error('Invalid viewport dimensions');
    }
    this.state.viewport = [x, y, width, height];
  });

  getParameter = jest.fn((pname: number) => {
    const params: Record<number, any> = {
      0x0D33: 4096, // MAX_TEXTURE_SIZE
      0x851C: 16384, // MAX_VERTEX_TEXTURE_IMAGE_UNITS
      0x8872: 16, // MAX_COMBINED_TEXTURE_IMAGE_UNITS
    };
    return params[pname] || 0;
  });

  createShader = jest.fn((type: number) => {
    return { type, source: '', compiled: false };
  });

  shaderSource = jest.fn((shader: any, source: string) => {
    shader.source = source;
  });

  compileShader = jest.fn((shader: any) => {
    shader.compiled = true;
  });

  getShaderParameter = jest.fn((shader: any, pname: number) => {
    if (pname === 0x8B81) { // COMPILE_STATUS
      return shader.compiled;
    }
    return true;
  });

  getState() {
    return { ...this.state };
  }

  reset() {
    this.state.clearColor = [0, 0, 0, 1];
    this.state.viewport = [0, 0, 800, 600];
    this.state.enabledCapabilities.clear();
    this.state.currentProgram = null;
    this.state.boundBuffers.clear();
    this.state.boundTextures.clear();
  }

  private validateColorValue(...values: number[]) {
    for (const value of values) {
      if (value < 0 || value > 1) {
        throw new Error(`Color value ${value} out of range [0, 1]`);
      }
    }
  }
}

/**
 * Test double factory for creating various test doubles
 */
export class TestDoubleFactory {
  /**
   * Create a stub that returns predefined values based on input
   */
  static createStub<T extends (...args: any[]) => any>(
    responses: Map<string, ReturnType<T>> | ((args: Parameters<T>) => ReturnType<T>)
  ): jest.Mock<T> {
    return jest.fn((...args: Parameters<T>) => {
      if (responses instanceof Map) {
        const key = JSON.stringify(args);
        return responses.get(key);
      }
      return responses(args);
    }) as any;
  }

  /**
   * Create a fake that simulates real behavior
   */
  static createFake<T>(
    implementation: Partial<T>,
    options: {
      strict?: boolean;
      throwOnMissing?: boolean;
    } = {}
  ): T {
    const handler: ProxyHandler<any> = {
      get(target, prop) {
        if (prop in target) {
          return target[prop];
        }
        
        if (options.throwOnMissing) {
          throw new Error(`Property ${String(prop)} not implemented in fake`);
        }
        
        if (options.strict) {
          return undefined;
        }
        
        // Return a no-op function for missing methods
        return jest.fn();
      },
    };

    return new Proxy(implementation, handler) as T;
  }

  /**
   * Create a dummy object with all methods as no-ops
   */
  static createDummy<T>(shape: Record<keyof T, 'method' | 'property'>): T {
    const dummy: any = {};
    
    for (const [key, type] of Object.entries(shape)) {
      if (type === 'method') {
        dummy[key] = jest.fn();
      } else {
        dummy[key] = undefined;
      }
    }
    
    return dummy;
  }
}

// Export convenience functions
export const mockBuilder = <T>() => new MockBuilder<T>();
export const statefulNetworkMock = () => new StatefulNetworkManagerMock();
export const validatingWebGL = () => new ValidatingWebGLMock();