# Build and Configuration Improvements

## 1. Build Process Optimization

### 1.1 Vite Configuration Enhancement
**Current**: Basic Vite config
```typescript
// vite.config.ts - minimal configuration
```

**Improved**: Comprehensive build optimization
```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { visualizer } from 'rollup-plugin-visualizer';
import compression from 'vite-plugin-compression';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@core': resolve(__dirname, './src/core'),
      '@ui': resolve(__dirname, './src/ui'),
      '@rendering': resolve(__dirname, './src/rendering'),
      '@network': resolve(__dirname, './src/network'),
      '@utils': resolve(__dirname, './src/utils'),
      '@types': resolve(__dirname, './src/types'),
    }
  },
  
  build: {
    target: 'es2022',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-three': ['three'],
          'vendor-peer': ['peerjs'],
          'vendor-ui': ['@tweenjs/tween.js'],
          'game-core': ['./src/core/index.ts'],
          'game-rendering': ['./src/rendering/index.ts'],
        }
      }
    },
    chunkSizeWarningLimit: 1000,
  },
  
  plugins: [
    compression({
      algorithm: 'brotliCompress',
      ext: '.br',
    }),
    visualizer({
      filename: './dist/stats.html',
      open: false,
      gzipSize: true,
      brotliSize: true,
    }),
  ],
});
```

### 1.2 Environment Configuration
**Problem**: No environment-specific configs
**Solution**: Add environment management
```typescript
// config/env.ts
export interface Environment {
  API_URL: string;
  PEER_SERVER: string;
  DEBUG_MODE: boolean;
  PERFORMANCE_MONITORING: boolean;
  ANALYTICS_ENABLED: boolean;
}

// .env.development
VITE_API_URL=http://localhost:3001
VITE_PEER_SERVER=localhost
VITE_DEBUG_MODE=true
VITE_PERFORMANCE_MONITORING=true
VITE_ANALYTICS_ENABLED=false

// .env.production
VITE_API_URL=https://api.pente3d.ai
VITE_PEER_SERVER=peer.pente3d.ai
VITE_DEBUG_MODE=false
VITE_PERFORMANCE_MONITORING=false
VITE_ANALYTICS_ENABLED=true
```

## 2. TypeScript Configuration

### 2.1 Stricter Type Checking
**Current**: Basic TypeScript config
**Improved**: Comprehensive type safety
```json
// tsconfig.json
{
  "compilerOptions": {
    // Strict Type-Checking
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    
    // Additional Checks
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    
    // Module Resolution
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@core/*": ["src/core/*"],
      "@ui/*": ["src/ui/*"],
      "@rendering/*": ["src/rendering/*"],
      "@network/*": ["src/network/*"],
      "@utils/*": ["src/utils/*"],
      "@types/*": ["src/types/*"]
    },
    
    // Emit
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "removeComments": false,
    "importHelpers": true,
    
    // Experimental
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist", "coverage"]
}
```

### 2.2 Type Definition Generation
```json
// tsconfig.build.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "declarationDir": "./dist/types",
    "emitDeclarationOnly": true
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts", "src/**/*.spec.ts"]
}
```

## 3. ESLint Configuration Enhancement

### 3.1 Comprehensive Linting Rules
```javascript
// eslint.config.js
import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
      'import': importPlugin,
    },
    rules: {
      // TypeScript Specific
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_' 
      }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      
      // Import Organization
      'import/order': ['error', {
        'groups': [
          'builtin',
          'external',
          'internal',
          'parent',
          'sibling',
          'index'
        ],
        'newlines-between': 'always',
        'alphabetize': { order: 'asc' }
      }],
      'import/no-duplicates': 'error',
      'import/no-cycle': 'error',
      
      // Code Quality
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
      
      // Pente3D Specific
      'no-magic-numbers': ['warn', {
        ignore: [0, 1, -1, 2],
        ignoreArrayIndexes: true,
        enforceConst: true,
      }],
    },
  },
  prettier,
];
```

## 4. Testing Configuration

### 4.1 Jest Configuration Enhancement
```javascript
// jest.config.js
export default {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  
  // Setup
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  globalSetup: '<rootDir>/tests/global-setup.ts',
  globalTeardown: '<rootDir>/tests/global-teardown.ts',
  
  // Module Resolution
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@ui/(.*)$': '<rootDir>/src/ui/$1',
    '^@rendering/(.*)$': '<rootDir>/src/rendering/$1',
    '^@network/(.*)$': '<rootDir>/src/network/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@types/(.*)$': '<rootDir>/src/types/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  
  // Coverage
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
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
  
  // Performance
  maxWorkers: '50%',
  cache: true,
  cacheDirectory: '<rootDir>/.jest-cache',
};
```

### 4.2 Playwright Configuration Enhancement
```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : '50%',
  
  reporter: [
    ['html', { outputFolder: '.test-output/playwright-report' }],
    ['json', { outputFile: '.test-output/results.json' }],
    ['junit', { outputFile: '.test-output/junit.xml' }],
    process.env.CI ? ['github'] : ['list'],
  ],
  
  outputDir: '.test-output/test-results',
  
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    
    // Custom test attributes
    testIdAttribute: 'data-testid',
    
    // Timeouts
    navigationTimeout: 30000,
    actionTimeout: 10000,
  },
  
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--disable-blink-features=AutomationControlled']
        }
      },
    },
    {
      name: 'firefox',
      use: { 
        ...devices['Desktop Firefox'],
        launchOptions: {
          headless: true,
          firefoxUserPrefs: {
            'media.navigator.streams.fake': true,
            'media.navigator.permission.disabled': true,
          }
        }
      },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'] },
    },
  ],
  
  webServer: {
    command: process.env.CI ? 'npm run preview' : 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
```

## 5. Package Scripts Enhancement

### 5.1 Comprehensive Script Commands
```json
// package.json scripts section
{
  "scripts": {
    // Development
    "dev": "vite",
    "dev:host": "vite --host",
    "dev:https": "vite --https",
    
    // Building
    "build": "run-s clean type-check lint test:unit build:app",
    "build:app": "vite build",
    "build:types": "tsc -p tsconfig.build.json",
    "build:analyze": "vite build --mode analyze",
    
    // Testing
    "test": "run-s test:unit test:integration test:e2e",
    "test:unit": "jest --passWithNoTests",
    "test:integration": "jest --testPathPattern=integration",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:debug": "playwright test --debug",
    "test:coverage": "jest --coverage",
    
    // Code Quality
    "lint": "eslint . --ext .ts,.tsx",
    "lint:fix": "eslint . --ext .ts,.tsx --fix",
    "format": "prettier --write \"**/*.{ts,tsx,js,jsx,json,css,md}\"",
    "format:check": "prettier --check \"**/*.{ts,tsx,js,jsx,json,css,md}\"",
    "type-check": "tsc --noEmit",
    
    // Utilities
    "clean": "rimraf dist coverage .test-output",
    "preview": "vite preview",
    "serve": "serve -s dist",
    
    // CI/CD
    "ci:test": "run-s lint type-check test:coverage test:e2e",
    "ci:build": "run-s clean build",
    
    // Release
    "version": "changeset version",
    "release": "changeset publish"
  }
}
```

## 6. CI/CD Configuration

### 6.1 GitHub Actions Workflow
```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run format:check
      - run: npm run type-check

  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run test:unit -- --shard=${{ matrix.shard }}/4
      - run: npm run test:integration
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage-${{ matrix.shard }}
          path: coverage/

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run build
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: .test-output/playwright-report/

  build:
    needs: [lint, test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - run: npm run build:analyze
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/
```

## 7. Development Workflow

### 7.1 Pre-commit Hooks
```json
// .husky/pre-commit
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

npm run lint:fix
npm run format
npm run type-check
```

### 7.2 Commit Message Convention
```json
// .commitlintrc.json
{
  "extends": ["@commitlint/config-conventional"],
  "rules": {
    "type-enum": [
      2,
      "always",
      [
        "feat",     // New feature
        "fix",      // Bug fix
        "docs",     // Documentation
        "style",    // Formatting
        "refactor", // Code change that neither fixes a bug nor adds a feature
        "perf",     // Performance improvement
        "test",     // Adding tests
        "chore",    // Maintenance
        "revert"    // Revert a commit
      ]
    ]
  }
}
```

## 8. Development Tools Configuration

### 8.1 VS Code Settings
```json
// .vscode/settings.json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true,
    "source.organizeImports": true
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "jest.autoRun": {
    "watch": false,
    "onSave": "test-file"
  },
  "files.exclude": {
    "**/node_modules": true,
    "**/dist": true,
    "**/.test-output": true,
    "**/coverage": true
  }
}
```

### 8.2 Debug Configuration
```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "chrome",
      "request": "launch",
      "name": "Debug Pente3D",
      "url": "http://localhost:3000",
      "webRoot": "${workspaceFolder}",
      "sourceMaps": true,
      "runtimeArgs": ["--disable-web-security"]
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Jest Debug",
      "program": "${workspaceFolder}/node_modules/.bin/jest",
      "args": ["--runInBand", "--no-cache", "${relativeFile}"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

## 9. Performance Monitoring

### 9.1 Build Performance
```javascript
// scripts/build-performance.js
import { performance } from 'perf_hooks';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function measureBuildPerformance() {
  const start = performance.now();
  
  const metrics = {
    clean: 0,
    typeCheck: 0,
    lint: 0,
    test: 0,
    build: 0,
    total: 0
  };
  
  // Measure each step
  const steps = [
    { name: 'clean', command: 'npm run clean' },
    { name: 'typeCheck', command: 'npm run type-check' },
    { name: 'lint', command: 'npm run lint' },
    { name: 'test', command: 'npm run test:unit' },
    { name: 'build', command: 'npm run build:app' }
  ];
  
  for (const step of steps) {
    const stepStart = performance.now();
    await execAsync(step.command);
    metrics[step.name] = performance.now() - stepStart;
  }
  
  metrics.total = performance.now() - start;
  
  console.table(metrics);
  
  // Write to file for tracking
  const fs = require('fs').promises;
  await fs.appendFile(
    'build-metrics.log',
    JSON.stringify({ date: new Date(), ...metrics }) + '\n'
  );
}
```

## 10. Security Configuration

### 10.1 Dependency Scanning
```json
// package.json
{
  "scripts": {
    "security:audit": "npm audit --audit-level=moderate",
    "security:check": "npx depcheck && npm-check-updates",
    "security:fix": "npm audit fix"
  }
}
```

### 10.2 Environment Variable Validation
```typescript
// src/config/env.validation.ts
import { z } from 'zod';

const envSchema = z.object({
  VITE_API_URL: z.string().url(),
  VITE_PEER_SERVER: z.string(),
  VITE_DEBUG_MODE: z.string().transform(v => v === 'true'),
  VITE_PERFORMANCE_MONITORING: z.string().transform(v => v === 'true'),
  VITE_ANALYTICS_ENABLED: z.string().transform(v => v === 'true'),
});

export function validateEnv() {
  try {
    return envSchema.parse(import.meta.env);
  } catch (error) {
    console.error('Invalid environment configuration:', error);
    throw new Error('Environment validation failed');
  }
}
```