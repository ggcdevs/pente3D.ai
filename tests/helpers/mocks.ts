/**
 * Mock factories and utilities for testing
 */

import { jest } from '@jest/globals';
import type { NetworkManager } from '@/network';
import type { StorageManager } from '@/storage';
import type { Renderer } from '@/rendering';
import type { Game, Board, Player, GameState } from '@/core';
import type { InputHandler } from '@/ui';
import type { Settings } from '@/storage';
import { MockBuilder } from './mocks/advanced';

// Re-export advanced mocks
export * from './mocks/advanced';

/**
 * Create a mock NetworkManager
 */
export function createMockNetworkManager(): jest.Mocked<NetworkManager> {
  return {
    hostGame: jest.fn().mockResolvedValue('ABCD1234'),
    joinGame: jest.fn().mockResolvedValue(undefined),
    sendMove: jest.fn().mockReturnValue(true),
    sendUndo: jest.fn(),
    sendRedo: jest.fn(),
    sendReset: jest.fn(),
    requestSync: jest.fn(),
    getStatus: jest.fn().mockReturnValue('disconnected'),
    getConnectionInfo: jest.fn().mockReturnValue({
      peerId: '',
      gameCode: '',
      isHost: false,
      status: 'disconnected',
      lastActivity: Date.now(),
      latency: 0,
      playerColor: undefined,
      opponentConnected: false,
    }),
    getLatency: jest.fn().mockReturnValue(0),
    isLocalPlayerTurn: jest.fn().mockReturnValue(true),
    getLocalPlayerColor: jest.fn().mockReturnValue(undefined),
    isNetworked: jest.fn().mockReturnValue(false),
    disconnect: jest.fn(),
    dispose: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
    removeAllListeners: jest.fn(),
    getConflictLogs: jest.fn().mockReturnValue([]),
    detectAndReportConflict: jest.fn(),
  } as any;
}

/**
 * Create a mock StorageManager
 */
export function createMockStorageManager(): typeof StorageManager {
  return {
    saveGame: jest.fn(),
    loadGame: jest.fn().mockReturnValue(null),
    clearGame: jest.fn(),
    saveSettings: jest.fn(),
    loadSettings: jest.fn().mockReturnValue({
      getColors: jest.fn().mockReturnValue({}),
      getOpacitySettings: jest.fn().mockReturnValue({}),
      toJSON: jest.fn().mockReturnValue({}),
    }),
    clearSettings: jest.fn(),
    exportData: jest.fn().mockReturnValue('{}'),
    importData: jest.fn().mockReturnValue(true),
    clearAll: jest.fn(),
  };
}

/**
 * Create a mock Renderer
 */
export function createMockRenderer(): jest.Mocked<Renderer> {
  const mockRenderer = {
    setBoard: jest.fn(),
    updatePieces: jest.fn(),
    addTemporaryPiece: jest.fn(),
    removeTemporaryPiece: jest.fn(),
    clearTemporaryPieces: jest.fn(),
    highlightPosition: jest.fn(),
    unhighlightPosition: jest.fn(),
    highlightLine: jest.fn(),
    unhighlightLine: jest.fn(),
    clearAllLineHighlights: jest.fn(),
    highlightPiece: jest.fn(),
    unhighlightPiece: jest.fn(),
    highlightConnectedPieces: jest.fn(),
    highlightCapturablePieces: jest.fn(),
    clearAllPieceHighlights: jest.fn(),
    setTemporaryPiece: jest.fn(),
    clearTemporaryPiece: jest.fn(),
    updateCurrentPlayerIndicator: jest.fn(),
    updateCaptureCount: jest.fn(),
    startRenderLoop: jest.fn(),
    stopRenderLoop: jest.fn(),
    render: jest.fn(),
    clearAllHighlights: jest.fn(),
    applyColorSettings: jest.fn(),
    applyOpacitySettings: jest.fn(),
    updateElementColor: jest.fn(),
    updateElementOpacity: jest.fn(),
    enterPreviewMode: jest.fn(),
    exitPreviewMode: jest.fn(),
    applyPreviewSettings: jest.fn(),
    dispose: jest.fn(),
    getScene: jest.fn(),
    getCamera: jest.fn(),
    getRenderer: jest.fn(),
    getControls: jest.fn(),
    setPerformanceMonitor: jest.fn(),
    setQualityManager: jest.fn(),
    focusCameraOnPosition: jest.fn(),
    setReducedMotion: jest.fn(),
  } as any;

  return mockRenderer;
}

/**
 * Create a mock HTMLCanvasElement
 */
export function createMockCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  
  // Mock WebGL context
  const mockContext = {
    clearColor: jest.fn(),
    clear: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    viewport: jest.fn(),
    getParameter: jest.fn().mockReturnValue(1024),
    getExtension: jest.fn().mockReturnValue({}),
    createShader: jest.fn().mockReturnValue({}),
    shaderSource: jest.fn(),
    compileShader: jest.fn(),
    getShaderParameter: jest.fn().mockReturnValue(true),
    createProgram: jest.fn().mockReturnValue({}),
    attachShader: jest.fn(),
    linkProgram: jest.fn(),
    getProgramParameter: jest.fn().mockReturnValue(true),
    useProgram: jest.fn(),
    createBuffer: jest.fn().mockReturnValue({}),
    bindBuffer: jest.fn(),
    bufferData: jest.fn(),
    createTexture: jest.fn().mockReturnValue({}),
    bindTexture: jest.fn(),
    texImage2D: jest.fn(),
    texParameteri: jest.fn(),
    drawArrays: jest.fn(),
    drawElements: jest.fn(),
  };

  // Override getContext to return our mock
  jest.spyOn(canvas, 'getContext').mockImplementation((contextType: string) => {
    if (contextType === 'webgl' || contextType === 'webgl2') {
      return mockContext as any;
    }
    return null;
  });

  return canvas;
}

/**
 * Create a mock DOM environment for tests
 */
export function setupMockDOM(): void {
  // Create root element
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);

  // Create canvas element
  const canvas = createMockCanvas();
  canvas.id = 'game-canvas';
  root.appendChild(canvas);

  // Mock window methods
  Object.defineProperty(window, 'requestAnimationFrame', {
    value: jest.fn((cb) => setTimeout(cb, 16)),
    writable: true,
  });

  Object.defineProperty(window, 'cancelAnimationFrame', {
    value: jest.fn((id) => clearTimeout(id)),
    writable: true,
  });

  // Mock localStorage
  const localStorageMock = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
  };
  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    writable: true,
  });
}

/**
 * Clean up mock DOM after tests
 */
export function cleanupMockDOM(): void {
  document.body.innerHTML = '';
}

/**
 * Mock performance.now() for consistent timing in tests
 */
export function mockPerformanceNow(): jest.MockedFunction<() => number> & {
  advance: (ms: number) => void;
  set: (time: number) => void;
  reset: () => void;
} {
  let currentTime = 0;
  const mock = jest.fn(() => currentTime) as any;
  
  Object.defineProperty(performance, 'now', {
    value: mock,
    writable: true,
  });

  // Helper to advance time
  mock.advance = (ms: number) => {
    currentTime += ms;
  };

  // Helper to set specific time
  mock.set = (time: number) => {
    currentTime = time;
  };

  // Helper to reset time
  mock.reset = () => {
    currentTime = 0;
  };

  return mock;
}

/**
 * Create a mock ResizeObserver
 */
export function mockResizeObserver(): void {
  global.ResizeObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  }));
}

/**
 * Create a mock IntersectionObserver
 */
export function mockIntersectionObserver(): void {
  global.IntersectionObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  }));
}

/**
 * Create a mock Game instance
 */
export function createMockGame(): jest.Mocked<Game> {
  return new MockBuilder<Game>()
    .withReturn('getCurrentState', {
      getCurrentPlayer: jest.fn().mockReturnValue({ color: 'black' }),
      getBoard: jest.fn(),
      getHistory: jest.fn().mockReturnValue([]),
      getMoveNumber: jest.fn().mockReturnValue(0),
      getWinner: jest.fn().mockReturnValue(null),
      getCapturedCounts: jest.fn().mockReturnValue({ black: 0, white: 0 }),
    } as any)
    .withReturn('getBoard', new MockBuilder<Board>()
      .withReturn('getSize', 7)
      .withReturn('getAllPieces', [])
      .withReturn('getPieceAt', null)
      .withReturn('isValidPosition', true)
      .build()
    )
    .withReturn('placePiece', true)
    .withReturn('undo', true)
    .withReturn('redo', true)
    .withMethod('reset', jest.fn())
    .withReturn('canUndo', true)
    .withReturn('canRedo', false)
    .withReturn('getHistory', [])
    .withReturn('getHistoryLength', 0)
    .withReturn('exportGame', '{}')
    .withResolve('importGame', true)
    .build();
}

/**
 * Create a mock InputHandler
 */
export function createMockInputHandler(): jest.Mocked<InputHandler> {
  const mockElement = document.createElement('div');
  
  return new MockBuilder<InputHandler>()
    .withProperty('element', mockElement)
    .withProperty('enabled', true)
    .withMethod('setRenderer', jest.fn())
    .withMethod('setGame', jest.fn())
    .withMethod('setNetworkManager', jest.fn())
    .withMethod('enable', jest.fn())
    .withMethod('disable', jest.fn())
    .withMethod('dispose', jest.fn())
    .withMethod('handleKeyDown', jest.fn())
    .withMethod('handleMouseMove', jest.fn())
    .withMethod('handleClick', jest.fn())
    .withMethod('handleWheel', jest.fn())
    .build();
}

/**
 * Create a mock Settings instance
 */
export function createMockSettings(): jest.Mocked<Settings> {
  const themes = new Map([
    ['default', { id: 'default', name: 'Default', colors: {} }],
    ['dark', { id: 'dark', name: 'Dark', colors: {} }],
  ]);

  return new MockBuilder<Settings>()
    .withReturn('getThemes', themes)
    .withReturn('getActiveTheme', 'default')
    .withMethod('setActiveTheme', jest.fn())
    .withReturn('getColors', {})
    .withMethod('setColor', jest.fn())
    .withReturn('getOpacitySettings', {})
    .withMethod('setOpacity', jest.fn())
    .withReturn('toJSON', {})
    .withMethod('fromJSON', jest.fn())
    .withMethod('reset', jest.fn())
    .build();
}

/**
 * Create a mock Player
 */
export function createMockPlayer(color: 'black' | 'white' = 'black'): jest.Mocked<Player> {
  return new MockBuilder<Player>()
    .withProperty('color', color)
    .withReturn('getId', `${color}-player`)
    .withReturn('getColor', color)
    .withReturn('isLocal', true)
    .withReturn('getConnectionId', undefined)
    .withReturn('toJSON', { id: `${color}-player`, color, isLocal: true })
    .build();
}

/**
 * Create mock WebGL extensions
 */
export function mockWebGLExtensions(): Record<string, any> {
  return {
    WEBGL_lose_context: {
      loseContext: jest.fn(),
      restoreContext: jest.fn(),
    },
    OES_texture_float: {},
    OES_standard_derivatives: {},
    ANGLE_instanced_arrays: {
      drawArraysInstancedANGLE: jest.fn(),
      drawElementsInstancedANGLE: jest.fn(),
      vertexAttribDivisorANGLE: jest.fn(),
    },
  };
}

/**
 * Mock factory configuration for consistent test setup
 */
export interface MockFactoryConfig {
  network?: {
    connected?: boolean;
    isHost?: boolean;
    gameCode?: string;
    latency?: number;
  };
  storage?: {
    hasStoredGame?: boolean;
    storedSettings?: any;
  };
  renderer?: {
    isRendering?: boolean;
    fps?: number;
  };
}

/**
 * Create a complete mock environment
 */
export function createMockEnvironment(config: MockFactoryConfig = {}): {
  network: jest.Mocked<NetworkManager>;
  storage: typeof StorageManager;
  renderer: jest.Mocked<Renderer>;
  game: jest.Mocked<Game>;
  input: jest.Mocked<InputHandler>;
  settings: jest.Mocked<Settings>;
  cleanup: () => void;
} {
  // Set up DOM
  setupMockDOM();
  mockResizeObserver();
  mockIntersectionObserver();
  
  // Create mocks based on config
  const network = createMockNetworkManager();
  if (config.network?.connected) {
    network.getStatus.mockReturnValue('connected');
    network.getConnectionInfo.mockReturnValue({
      peerId: config.network.isHost ? 'host-peer' : 'client-peer',
      gameCode: config.network.gameCode || 'ABCD1234',
      isHost: config.network.isHost || false,
      status: 'connected',
      lastActivity: Date.now(),
      latency: config.network.latency || 50,
      playerColor: config.network.isHost ? 'black' : 'white',
      opponentConnected: true,
    });
  }

  const storage = createMockStorageManager();
  if (config.storage?.hasStoredGame) {
    storage.loadGame.mockReturnValue({
      version: '1.0.0',
      timestamp: Date.now(),
      gameState: {},
    });
  }
  if (config.storage?.storedSettings) {
    storage.loadSettings.mockReturnValue(config.storage.storedSettings);
  }

  const renderer = createMockRenderer();
  const game = createMockGame();
  const input = createMockInputHandler();
  const settings = createMockSettings();

  const cleanup = () => {
    cleanupMockDOM();
    jest.clearAllMocks();
  };

  return {
    network,
    storage,
    renderer,
    game,
    input,
    settings,
    cleanup,
  };
}

/**
 * Mock utilities for async testing
 */
export const AsyncMockUtils = {
  /**
   * Wait for mock to be called with specific arguments
   */
  async waitForCall(
    mock: jest.Mock,
    expectedArgs?: any[],
    timeout = 1000
  ): Promise<void> {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      if (expectedArgs) {
        const found = mock.mock.calls.some(call =>
          JSON.stringify(call) === JSON.stringify(expectedArgs)
        );
        if (found) return;
      } else if (mock.mock.calls.length > 0) {
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    throw new Error(`Mock was not called with expected args within ${timeout}ms`);
  },

  /**
   * Wait for condition to be true
   */
  async waitForCondition(
    condition: () => boolean,
    timeout = 1000,
    message = 'Condition not met'
  ): Promise<void> {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      if (condition()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    throw new Error(`${message} within ${timeout}ms`);
  },

  /**
   * Flush all pending promises
   */
  async flushPromises(): Promise<void> {
    await new Promise(resolve => setImmediate(resolve));
  },
};