# Chunk 0.1: Project Infrastructure - Development Guide

## Overview
Set up the complete development environment and build pipeline for Pente3D.ai. This chunk establishes the foundation for all subsequent development work.

## Prerequisites
- Node.js 18+ installed
- Git repository initialized
- Modern web browser for testing

## Step-by-Step Implementation

### Step 1: Initialize Vite Project
```bash
# Initialize new Vite project with TypeScript
npm create vite@latest . -- --template vanilla-ts

# Install core dependencies
npm install three @types/three peerjs

# Install development dependencies
npm install -D jest @types/jest ts-jest @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint prettier eslint-config-prettier eslint-plugin-prettier
```

### Step 2: Configure TypeScript
Create `tsconfig.json` with strict settings:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": "./src",
    "paths": {
      "@/*": ["./*"],
      "@/core/*": ["./core/*"],
      "@/rendering/*": ["./rendering/*"],
      "@/ui/*": ["./ui/*"],
      "@/network/*": ["./network/*"],
      "@/utils/*": ["./utils/*"],
      "@/types/*": ["./types/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Step 3: Set Up Project Structure
Create the following directory structure:
```
src/
├── core/           # Game logic classes
├── rendering/      # Three.js rendering
├── ui/            # DOM-based UI components
├── network/       # PeerJS networking
├── utils/         # Utility functions
├── types/         # TypeScript type definitions
└── main.ts        # Application entry point
```

### Step 4: Configure Jest Testing
Create `jest.config.js`:
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/main.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
```

### Step 5: Configure ESLint and Prettier
Create `.eslintrc.json`:
```json
{
  "extends": [
    "eslint:recommended",
    "@typescript-eslint/recommended",
    "prettier"
  ],
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint", "prettier"],
  "root": true,
  "env": {
    "browser": true,
    "es2020": true
  },
  "rules": {
    "prettier/prettier": "error",
    "@typescript-eslint/no-unused-vars": "error",
    "@typescript-eslint/explicit-function-return-type": "warn"
  }
}
```

Create `.prettierrc`:
```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 80,
  "tabWidth": 2
}
```

### Step 6: Update Vite Configuration
Modify `vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/core': path.resolve(__dirname, './src/core'),
      '@/rendering': path.resolve(__dirname, './src/rendering'),
      '@/ui': path.resolve(__dirname, './src/ui'),
      '@/network': path.resolve(__dirname, './src/network'),
      '@/utils': path.resolve(__dirname, './src/utils'),
      '@/types': path.resolve(__dirname, './src/types'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    target: 'es2020',
    minify: 'terser',
    sourcemap: true,
  },
});
```

### Step 7: Create Basic HTML Structure
Update `index.html`:
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pente3D.ai - 3D Pente Game</title>
    <meta name="description" content="3D web-based Pente game with peer-to-peer multiplayer" />
  </head>
  <body>
    <div id="app">
      <canvas id="game-canvas"></canvas>
      <div id="ui-overlay">
        <div id="loading">Loading Pente3D...</div>
      </div>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

### Step 8: Update package.json Scripts
Add/modify scripts in `package.json`:
```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "lint": "eslint src --ext .ts,.tsx",
    "lint:fix": "eslint src --ext .ts,.tsx --fix",
    "format": "prettier --write src/**/*.{ts,tsx,css,html}",
    "type-check": "tsc --noEmit"
  }
}
```

### Step 9: Create Initial Main Entry Point
Create `src/main.ts`:
```typescript
import './style.css';

console.log('Pente3D.ai initializing...');

// Basic application bootstrap
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const loading = document.getElementById('loading');
  
  if (!canvas) {
    throw new Error('Game canvas element not found');
  }
  
  // Hide loading indicator
  if (loading) {
    loading.style.display = 'none';
  }
  
  // Basic canvas setup
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  
  console.log('Pente3D.ai initialized successfully');
});

// Handle window resize
window.addEventListener('resize', () => {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
});
```

### Step 10: Create Basic CSS
Update `src/style.css`:
```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  height: 100%;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  overflow: hidden;
}

#app {
  width: 100vw;
  height: 100vh;
  position: relative;
}

#game-canvas {
  display: block;
  width: 100%;
  height: 100%;
  background: #1a1a1a;
}

#ui-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 100;
}

#ui-overlay > * {
  pointer-events: auto;
}

#loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: white;
  font-size: 1.5rem;
  background: rgba(0, 0, 0, 0.8);
  padding: 2rem;
  border-radius: 8px;
}
```

### Step 11: Create Test Setup
Create `tests/setup.ts`:
```typescript
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
```

Create `tests/` directory structure:
```
tests/
├── setup.ts
├── unit/
├── integration/
└── e2e/
```

### Step 12: Create Initial Test
Create `tests/unit/main.test.ts`:
```typescript
/**
 * Basic smoke test to ensure the build system works
 */
describe('Build System', () => {
  test('TypeScript compilation works', () => {
    expect(true).toBe(true);
  });
  
  test('Jest testing framework works', () => {
    const testValue = 'test';
    expect(testValue).toBe('test');
  });
});
```

## Validation Checklist
- [ ] `npm install` completes without errors
- [ ] `npm run dev` starts development server
- [ ] `npm run build` creates production build
- [ ] `npm test` runs Jest tests successfully
- [ ] `npm run lint` passes ESLint checks
- [ ] `npm run type-check` passes TypeScript compilation
- [ ] Browser displays basic page with canvas
- [ ] Console shows "Pente3D.ai initialized successfully"
- [ ] No TypeScript compilation errors
- [ ] All directories created as specified

## Expected Deliverables
1. Complete Vite + TypeScript project setup
2. Configured build pipeline with all tools
3. Proper folder structure with path mapping
4. Working test framework with initial test
5. ESLint and Prettier configuration
6. Basic HTML structure with canvas element
7. Responsive CSS foundation
8. Development server running on port 3000

## Common Issues & Solutions

**Issue**: TypeScript path mapping not working
**Solution**: Ensure both `tsconfig.json` and `vite.config.ts` have matching path aliases

**Issue**: Jest tests failing with ES modules
**Solution**: Verify `jest.config.js` has correct `preset: 'ts-jest'` and transform settings

**Issue**: Three.js types not found
**Solution**: Ensure `@types/three` is installed and included in TypeScript compilation

**Issue**: Canvas not displaying
**Solution**: Check console for errors and verify canvas element ID matches JavaScript selector

This infrastructure setup provides a solid foundation for all subsequent development phases.