/**
 * Mock factories and utilities for testing
 */

import type { NetworkManager } from '@/network';
import type { StorageManager } from '@/storage';
import type { Renderer } from '@/rendering';

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
export function mockPerformanceNow(): jest.MockedFunction<() => number> {
  let currentTime = 0;
  const mock = jest.fn(() => currentTime);
  
  Object.defineProperty(performance, 'now', {
    value: mock,
    writable: true,
  });

  // Helper to advance time
  (mock as any).advance = (ms: number) => {
    currentTime += ms;
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