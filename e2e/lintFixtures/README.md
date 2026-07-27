# `e2e/lintFixtures/` — the specs that MUST fail lint

These files are not tests. They are the **evidence** that the e2e test-integrity lint rules in
`eslint.config.mjs` (`vitestTestIntegrity` + `playwrightTestIntegrity`) actually reject the things
they claim to reject — agent-principles #7, *"a gate you haven't watched reject something isn't a
gate"*.

- `disabledAndFocused.spec.ts` — one instance of every form the gate bans, plus the forms it
  deliberately allows (Playwright's runtime `test.skip(cond, reason)`).
- `clean.spec.ts` — a compliant spec. It proves the rules are not simply erroring on everything.

They are real `.spec.ts` files under `e2e/` on purpose, so the production globs
(`files: ['e2e/**/*.spec.ts']`) apply to them with no special-casing.

Two things keep them out of the normal runs, and neither weakens anything:

- `eslint.config.mjs` lists `e2e/lintFixtures/**` in `ignores`, so `npm run lint` stays green.
  `tools/lintGate.test.mjs` lints this directory explicitly with `--no-ignore` and asserts the
  exact `{ line, ruleId }` set eslint reports — so weakening a selector turns `npm test` red.
- `playwright.config.ts` sets `testIgnore` for this directory, so `npm run e2e` does not try to
  run them.

**Adding a case:** put it in `disabledAndFocused.spec.ts` with a `// <n>: …` comment naming the
damage it does, and — if it MUST error — a trailing `// LINT-EXPECT: <ruleId>` marker on the
offending line. `tools/lintGate.test.mjs` builds its expectation from those markers and asserts
eslint's output matches exactly, in both directions: a marked line that produces no error means the
selector has a hole, and an unmarked line that produces one means the selector is over-broad. So a
new case is never silently unenforced — add the marker before the selector covers it and the suite
goes red until it does.
