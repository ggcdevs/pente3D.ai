# Architecture diagrams

Auto-generated, at-a-glance views of the codebase shape — meant to orient a human
or an agent before diving into `src/`. Generated from the TypeScript AST, so they
never drift from reality as long as they're regenerated.

| File | What it shows |
|---|---|
| `class-hierarchy.mmd` | Every interface / class / enum / abstract, their public members, and inheritance/implementation edges. |
| `module-dependencies.mmd` | File-level import graph, grouped by directory (`src/core`, `src/net`, …). |
| `graph-data.json` | Structured JSON the generator emits — the source of truth for staleness checks and future impact analysis. |

These are **Mermaid** — GitHub renders `.mmd` inline, or paste into <https://mermaid.live>.

## Regenerate

```bash
npm run diagrams        # rewrite the .mmd + .json from src/
npm run diagrams:check  # exit 0 if up-to-date, 2 if stale (used by CI on main/test)
```

Config lives in `diagrams.json` at the repo root. Test files (`*.test.ts`, `*.spec.ts`)
are excluded so the views show the *architecture*, not the test scaffolding. SVG
rendering is off by default (no mermaid-cli / puppeteer dependency); set
`"renderSvg": true` to enable it.

The generator (`tools/generate-diagrams.mjs`) is adapted from the shared
`claude-hooks` TypeScript diagram tooling.

> **Deferred:** a commit-time *blast-radius* review built on `graph-data.json`
> ("you changed X's contract; consumers Y/Z had no test delta — confirm") is
> designed but not built. See issue #25.
