/**
 * Ambient declarations for the compile-time constants Vite substitutes at build time.
 *
 * A `define` entry is a TEXT SUBSTITUTION, not a runtime import, so TypeScript needs to be
 * told the identifier exists — otherwise `tsc --noEmit` (the first half of `npm run build`)
 * fails on every use. Keep this file in sync with `vite.config.ts`'s `define` block.
 */

/**
 * The version of this build, resolved FROM GIT TAGS at build time (issue #22).
 *
 * `X.Y.Z` when the build sits exactly on a tag, otherwise the full `git describe` form
 * (`v3.0.0-84-gb0cf3cb`), otherwise `0.0.0-unknown` when no tag is reachable. See
 * `tools/version.mjs` and the README "Versioning" section. NOT `package.json`'s version.
 */
declare const __APP_VERSION__: string;
