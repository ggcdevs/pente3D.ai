/**
 * Consolidated E2E test utilities
 * Merges existing E2E helpers with the new test helper library
 */

export * from './game-page';
export * from './visual-testing';
export * from './browser-helpers';
export * from './test-environment';

// For backward compatibility, export functions from old utilities
export { waitForSceneReady, captureCanvas } from '../../../e2e/utils/threejs-helpers';
export { compareScreenshots, expectScreenshotToMatchBaseline } from '../../../e2e/utils/visual-regression';