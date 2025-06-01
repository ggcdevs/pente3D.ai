// Jest setup file for global test configuration
import 'jest-canvas-mock';

// Mock Canvas API for Three.js
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Mock WebGL context
const mockWebGLContext = {
  getExtension: jest.fn(),
  getParameter: jest.fn(),
  // Add other WebGL methods as needed
};

HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue(mockWebGLContext);