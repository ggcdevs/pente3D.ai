/**
 * Example tests demonstrating enhanced mock factories
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { 
  createMockEnvironment,
  MockBuilder,
  StatefulNetworkManagerMock,
  SpyFactory,
  TestDoubleFactory,
  AsyncMockUtils,
  mockPerformanceNow,
  ValidatingWebGLMock
} from '@/tests/helpers/mocks';
import type { Game, Board, Player } from '@/core';
import type { NetworkManager } from '@/network';

describe('Enhanced Mock Factories Examples', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('MockBuilder', () => {
    it('should create flexible mocks with MockBuilder', () => {
      const mockGame = new MockBuilder<Game>()
        .withReturn('getBoard', { getSize: () => 13 } as Board)
        .withResolve('importGame', true)
        .withThrow('exportGame', 'Export not allowed')
        .withMethod('placePiece', jest.fn((pos) => pos.x === 0))
        .build();

      // Test return values
      expect(mockGame.getBoard().getSize()).toBe(13);

      // Test async resolution
      expect(mockGame.importGame('data')).resolves.toBe(true);

      // Test throwing
      expect(() => mockGame.exportGame()).toThrow('Export not allowed');

      // Test custom implementation
      expect(mockGame.placePiece({ x: 0, y: 0, z: 0 } as any)).toBe(true);
      expect(mockGame.placePiece({ x: 1, y: 0, z: 0 } as any)).toBe(false);
    });

    it('should track spies in MockBuilder', () => {
      const mockBoard = new MockBuilder<Board>()
        .withMethod('placePiece', jest.fn())
        .withReturn('getPieceAt', null)
        .build();

      mockBoard.placePiece({ x: 0, y: 0, z: 0 } as any, {} as Player);
      mockBoard.getPieceAt({ x: 0, y: 0, z: 0 });

      // Access spies
      expect(mockBoard._spies.get('placePiece')).toHaveBeenCalledWith(
        { x: 0, y: 0, z: 0 },
        expect.any(Object)
      );
      expect(mockBoard._spies.get('getPieceAt')).toHaveBeenCalled();
    });
  });

  describe('StatefulNetworkManagerMock', () => {
    it('should simulate real network behavior', async () => {
      const network = new StatefulNetworkManagerMock();

      // Start disconnected
      expect(network.getStatus()).toBe('disconnected');

      // Host game
      const gameCode = await network.hostGame();
      expect(gameCode).toMatch(/^[A-Z0-9]{8}$/);
      expect(network.getStatus()).toBe('connected');
      expect(network.getConnectionInfo().isHost).toBe(true);
      expect(network.getConnectionInfo().playerColor).toBe('black');

      // Simulate opponent move
      const moveHandler = jest.fn();
      network.on('move', moveHandler);
      
      network.simulateOpponentMove({
        position: { x: 0, y: 0, z: 0 },
        player: { color: 'white' } as Player,
        timestamp: Date.now(),
        capturedPieces: []
      } as any);

      expect(moveHandler).toHaveBeenCalled();
    });

    it('should simulate network latency', async () => {
      const network = new StatefulNetworkManagerMock();
      network.setLatency(100);

      const start = Date.now();
      await network.hostGame();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(100);
    });

    it('should handle connection errors', async () => {
      const network = new StatefulNetworkManagerMock();

      await expect(network.joinGame('SHORT')).rejects.toThrow('Invalid game code');
      expect(network.getStatus()).toBe('error');
    });
  });

  describe('SpyFactory', () => {
    it('should create configurable spies', () => {
      const spy = SpyFactory.createConfigurableSpy('testSpy', (x: number) => x * 2);

      // Default behavior
      expect(spy(5)).toBe(undefined);

      // Configure return value
      spy.configure({ returnValue: 42 });
      expect(spy(5)).toBe(42);

      // Configure to call through
      spy.configure({ callThrough: true });
      expect(spy(5)).toBe(10);

      // Configure to throw
      spy.configure({ throwError: 'Test error' });
      expect(() => spy(5)).toThrow('Test error');

      // Check calls
      expect(spy.getCalls()).toHaveLength(4);
      expect(spy.getCalls()[0]).toEqual([5]);
    });

    it('should create async spies with delays', async () => {
      const asyncSpy = SpyFactory.createAsyncSpy('asyncOp', {
        delay: 50,
        resolveWith: 'success'
      });

      const start = Date.now();
      const result = await asyncSpy();
      const elapsed = Date.now() - start;

      expect(result).toBe('success');
      expect(elapsed).toBeGreaterThanOrEqual(50);
    });

    it('should create state tracking spies', () => {
      const { spy, getState, setState, getStateHistory } = 
        SpyFactory.createStateSpy({ count: 0, active: false });

      // Initial state
      expect(getState()).toEqual({ count: 0, active: false });

      // Update via spy
      spy({ count: 1, active: true });
      expect(getState()).toEqual({ count: 1, active: true });

      // Update via setState
      setState({ count: 2, active: true });
      expect(getState()).toEqual({ count: 2, active: true });

      // Check history
      expect(getStateHistory()).toEqual([
        { count: 0, active: false },
        { count: 1, active: true },
        { count: 2, active: true }
      ]);
    });
  });

  describe('ValidatingWebGLMock', () => {
    it('should validate WebGL operations', () => {
      const gl = new ValidatingWebGLMock();

      // Valid operations
      gl.clearColor(0.5, 0.5, 0.5, 1.0);
      expect(gl.getState().clearColor).toEqual([0.5, 0.5, 0.5, 1.0]);

      // Invalid color values
      expect(() => gl.clearColor(1.5, 0, 0, 1)).toThrow('Color value 1.5 out of range');

      // Valid viewport
      gl.viewport(0, 0, 800, 600);
      expect(gl.getState().viewport).toEqual([0, 0, 800, 600]);

      // Invalid viewport
      expect(() => gl.viewport(0, 0, 0, 600)).toThrow('Invalid viewport dimensions');

      // Test shader compilation
      const shader = gl.createShader(0x8B31); // VERTEX_SHADER
      gl.shaderSource(shader, 'void main() {}');
      gl.compileShader(shader);
      expect(gl.getShaderParameter(shader, 0x8B81)).toBe(true); // COMPILE_STATUS
    });
  });

  describe('TestDoubleFactory', () => {
    it('should create stubs with predefined responses', () => {
      const responses = new Map([
        ['["hello"]', 'world'],
        ['["foo","bar"]', 'baz'],
      ]);

      const stub = TestDoubleFactory.createStub(responses);
      
      expect(stub('hello')).toBe('world');
      expect(stub('foo', 'bar')).toBe('baz');
      expect(stub('unknown')).toBeUndefined();
    });

    it('should create fakes with partial implementation', () => {
      interface Service {
        getData(): string;
        saveData(data: string): void;
        deleteData(): void;
      }

      const fake = TestDoubleFactory.createFake<Service>({
        getData: () => 'fake data',
        saveData: jest.fn(),
      }, { throwOnMissing: true });

      expect(fake.getData()).toBe('fake data');
      fake.saveData('test');
      expect((fake.saveData as jest.Mock).mock.calls).toHaveLength(1);

      expect(() => fake.deleteData()).toThrow('Property deleteData not implemented');
    });

    it('should create dummies', () => {
      interface Component {
        render: 'method';
        state: 'property';
        update: 'method';
      }

      const dummy = TestDoubleFactory.createDummy<Component>({
        render: 'method',
        state: 'property',
        update: 'method',
      });

      expect(dummy.render).toBeDefined();
      expect(typeof dummy.render).toBe('function');
      expect(dummy.state).toBeUndefined();
      
      (dummy.render as jest.Mock)();
      expect((dummy.render as jest.Mock).mock.calls).toHaveLength(1);
    });
  });

  describe('Complete Mock Environment', () => {
    it('should create connected network environment', () => {
      const env = createMockEnvironment({
        network: {
          connected: true,
          isHost: true,
          gameCode: 'TEST1234',
          latency: 25
        }
      });

      expect(env.network.getStatus()).toBe('connected');
      expect(env.network.getConnectionInfo()).toMatchObject({
        isHost: true,
        gameCode: 'TEST1234',
        latency: 25,
        playerColor: 'black'
      });

      env.cleanup();
    });

    it('should create environment with stored game', () => {
      const env = createMockEnvironment({
        storage: {
          hasStoredGame: true,
          storedSettings: { theme: 'dark' }
        }
      });

      const loadedGame = env.storage.loadGame();
      expect(loadedGame).toBeTruthy();
      expect(loadedGame.version).toBe('1.0.0');

      const settings = env.storage.loadSettings();
      expect(settings).toEqual({ theme: 'dark' });

      env.cleanup();
    });
  });

  describe('AsyncMockUtils', () => {
    it('should wait for mock calls', async () => {
      const mock = jest.fn();

      // Call mock after delay
      setTimeout(() => mock('test', 123), 50);

      await AsyncMockUtils.waitForCall(mock, ['test', 123]);
      expect(mock).toHaveBeenCalledWith('test', 123);
    });

    it('should wait for condition', async () => {
      let ready = false;

      setTimeout(() => { ready = true; }, 50);

      await AsyncMockUtils.waitForCondition(() => ready);
      expect(ready).toBe(true);
    });

    it('should timeout if condition not met', async () => {
      await expect(
        AsyncMockUtils.waitForCondition(() => false, 100, 'Never ready')
      ).rejects.toThrow('Never ready within 100ms');
    });
  });

  describe('Performance Mock', () => {
    it('should control time with mockPerformanceNow', () => {
      const perfMock = mockPerformanceNow();

      expect(performance.now()).toBe(0);

      perfMock.advance(100);
      expect(performance.now()).toBe(100);

      perfMock.set(5000);
      expect(performance.now()).toBe(5000);

      perfMock.reset();
      expect(performance.now()).toBe(0);
    });
  });
});