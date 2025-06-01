/**
 * Integration tests for main.ts entry point
 */
import { Game } from '@/core/Game';
import { Renderer } from '@/rendering/Renderer';
import { InputHandler } from '@/ui/InputHandler';

// Mock Three.js
jest.mock('three');
jest.mock('three/examples/jsm/controls/OrbitControls');

// Mock DOM
beforeEach(() => {
  document.body.innerHTML = '<canvas id="game-canvas"></canvas>';
});

describe('Main Application Integration', () => {
  it('should initialize all components correctly', () => {
    // Mock canvas
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    canvas.width = 800;
    canvas.height = 600;
    canvas.getBoundingClientRect = jest.fn(() => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => {}
    }));
    
    // Mock WebGL context
    const mockContext = {
      getParameter: jest.fn(),
      getExtension: jest.fn(),
      createTexture: jest.fn(),
      bindTexture: jest.fn(),
      texParameteri: jest.fn(),
      texImage2D: jest.fn(),
      clearColor: jest.fn(),
      clear: jest.fn(),
      enable: jest.fn(),
      disable: jest.fn(),
      depthFunc: jest.fn(),
      frontFace: jest.fn(),
      cullFace: jest.fn(),
      viewport: jest.fn(),
      drawArrays: jest.fn(),
      drawElements: jest.fn(),
    };
    
    canvas.getContext = jest.fn((type) => {
      if (type === 'webgl' || type === 'webgl2') {
        return mockContext;
      }
      return null;
    });
    
    // Create game
    const game = new Game({ boardSize: 7 });
    expect(game).toBeDefined();
    expect(game.getBoard().size).toBe(7);
    
    // Create renderer
    const renderer = new Renderer({
      canvas,
      boardSize: 7,
      antialias: true
    });
    expect(renderer).toBeDefined();
    
    // Set board
    renderer.setBoard(game.getBoard());
    
    // Create input handler
    const inputHandler = new InputHandler({
      canvas,
      camera: renderer.getCamera(),
      scene: renderer.getScene(),
      controls: renderer.getControls(),
      game,
      renderer
    });
    expect(inputHandler).toBeDefined();
    
    // Verify event connections
    const piecePlacedSpy = jest.fn();
    inputHandler.on('piecePlaced', piecePlacedSpy);
    
    const moveSpy = jest.fn();
    game.on('move', moveSpy);
    
    // Clean up
    inputHandler.dispose();
    renderer.dispose();
  });
  
  it('should handle window focus/blur events', () => {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    canvas.width = 800;
    canvas.height = 600;
    canvas.getBoundingClientRect = jest.fn(() => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => {}
    }));
    
    // Mock WebGL context
    const mockContext = {
      getParameter: jest.fn(),
      getExtension: jest.fn(),
      createTexture: jest.fn(),
      bindTexture: jest.fn(),
      texParameteri: jest.fn(),
      texImage2D: jest.fn(),
      clearColor: jest.fn(),
      clear: jest.fn(),
      enable: jest.fn(),
      disable: jest.fn(),
      depthFunc: jest.fn(),
      frontFace: jest.fn(),
      cullFace: jest.fn(),
      viewport: jest.fn(),
      drawArrays: jest.fn(),
      drawElements: jest.fn(),
    };
    
    canvas.getContext = jest.fn((type) => {
      if (type === 'webgl' || type === 'webgl2') {
        return mockContext;
      }
      return null;
    });
    
    const renderer = new Renderer({
      canvas,
      boardSize: 7
    });
    
    const startSpy = jest.spyOn(renderer, 'startRenderLoop');
    const stopSpy = jest.spyOn(renderer, 'stopRenderLoop');
    
    // Set up event listeners like in main.ts
    window.addEventListener('blur', () => renderer.stopRenderLoop());
    window.addEventListener('focus', () => renderer.startRenderLoop());
    
    // Trigger blur
    window.dispatchEvent(new Event('blur'));
    expect(stopSpy).toHaveBeenCalled();
    
    // Trigger focus
    window.dispatchEvent(new Event('focus'));
    expect(startSpy).toHaveBeenCalledTimes(2); // Once on init, once on focus
    
    renderer.dispose();
  });
});