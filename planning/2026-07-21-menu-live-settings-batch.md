# Menu & Live-Settings Batch — mini-plan

- **Date:** 2026-07-21
- **Status:** Design locked with user; ready to build.
- **Issues:** #15 (settings apply live), #24 (side-drawer menu), #13 (network in menu + code picker),
  #16 (CSS modernization), #14 (banner spacing bug — folded in).
- **Spawns:** #26 (retrofit `scene.onStateChange` onto the emitter factory — deferred cleanup).
- **Unblocks downstream:** #9 (board size), #19 (last-piece animation), and the rest of #24's siblings
  all reuse the config-change notification built here.
- **References:** `planning/agent-principles.md`, `planning/2026-07-19-render-ui-design.md` (Parts 4/5/6),
  `GLOSSARY.md`, `docs/diagrams/` (architecture overview).

## Goal

Settings **autosave and apply live** (no page reload) while the board stays visible, by editing in a
**non-blocking side drawer**; move **Host/Join into the menu** with a game-code picker; **modernize the
CSS**. Board-size changes remain deferred to the next game (per #15).

## Design decisions (locked)

1. **Config change notification lives at the config layer** as a general pub/sub — `setConfig` /
   `resetConfig` emit the changed **section name** after writing; subscribers re-read via `getConfig()`
   (the SSOT — no value is duplicated into the event). Universal: local *and* programmatic/networked
   writers (e.g. #9's opponent-changed-board-size over the relay) notify for free. NOT a global event bus
   — a single typed, config-owned emitter.
2. **Shared emitter factory**, not per-site boilerplate. `src/util/emitter.ts`:
   `createEmitter<T>() → { emit(payload: T), subscribe(fn): () => void }`. Pure, imports nothing (usable
   by any layer). Config's `onConfigChange` is `createEmitter<ConfigSection>()`. The handshake /
   notification tickets (#12/#18/#20) reuse it later. `scene.onStateChange` retrofit is #26 (opportunistic).
3. **Live-apply via `applyConfig(section)` seams on the scene**, generalizing the existing working
   `applyColors()`. Live-able sections re-apply on notification; **board size and camera preset stay
   reload/next-game** (baked into instanced buffers + grid at construction — do NOT force live).
4. **Non-blocking drawer** using the scope-stack's existing `blocking: false` support (first non-blocking
   overlay). The board keeps receiving camera/input while the drawer is open — that is what makes the
   live preview visible.
5. **Network game in the menu** (#13): retire the inline top-left Host/Join; put them under a
   "Network Game" menu entry with a game-code picker (custom / saved / random).
6. **CSS** (#16): modernize the single embedded `UI_STYLESHEET` in `container.ts` — best-effort, then
   collaborative tweaking with the user on the live page.

## Guardrails (design invariants — see agent-principles)

- **Subscribers unsubscribe on dispose** (widget `dispose?()`, scene teardown) — no listener leaks.
- **Never write config from inside a config listener** — react by re-reading + re-applying, never
  re-writing (would re-emit → loop).
- Emit **section only**; the payload is not the new value.
- `src/core` stays pure; the emitter util imports nothing; scene/widgets remain the glue that subscribes.

## Build steps

Each step notes its **test tier**: *pure* = Vitest unit + fast-check + Stryker mutation (in mutateScope);
*glue* = Playwright on the real app asserting `window.__pente` + screenshots (never log lines).

| # | Step | Key files | Tier |
|---|---|---|---|
| 1 | **Emitter factory** — `createEmitter<T>()` with subscribe/unsubscribe/emit; no double-fire; dispose-safe. | `src/util/emitter.ts` (new) | pure |
| 2 | **Config pub/sub** — `onConfigChange(section, fn): () => void`; `setConfig`/`resetConfig` emit after writing. | `src/config/config.ts` | pure |
| 3 | **Scene `applyConfig(section)` seams** — generalize `applyColors` to the live-able render sections (lighting, materials, geometry-where-cheap, blending, interaction, lineVisibility). Board/controls excluded (documented). | `src/render/scene.ts` | glue |
| 4 | **Wire the loop** — on `onConfigChange`, call `scene.applyConfig(section)` + refresh config-reading widgets (pass live `config` into `container.update`, which already accepts it). | `src/main.ts`, `src/ui/container.ts` | glue |
| 5 | **Settings autosave + copy** — confirm write-on-change (already the case); label board size "takes effect next game"; drop any reload messaging. | `src/ui/widgets/settings.ts`, `settingsModel.ts` | pure model + glue |
| 6 | **Non-blocking side drawer** — convert menu/settings from centered blocking modal to a right-edge drawer pushing a non-blocking scope; board stays interactive. | `src/ui/widgets/menu.ts`, `menuModel.ts`, `settings.ts`, `container.ts` (CSS) | model pure + glue |
| 7 | **Network game in menu + code picker** — "Network Game" entry; picker = custom / saved / random; retire inline Host/Join. | `src/ui/widgets/net.ts`, `netModel.ts`, `menu*.ts` | model pure + glue |
| 8 | **CSS modernization** — restyle drawer/menu/net in `UI_STYLESHEET`; then tweak live with user. | `src/ui/container.ts` | glue (screenshots) |
| 9 | **#14 banner spacing** — fix `White: 0Black: 0` → proper separation in the banner view-model. | `src/ui/widgets/bannerModel.ts`, `banner.ts` | pure |

## Sequencing & the integration seam

- **Increment A (#15 core, shippable):** steps 1 → 2 → 3 → 4 (+5). After this, changing a color/lighting
  value applies live with no reload — visible even before the drawer lands.
- **Increment B (UX):** step 6 (drawer) — pairs with A so you can watch the board while editing.
- **Increment C:** step 7 (net-in-menu) depends on B's menu structure; then step 8 (CSS).
- **Anytime:** step 9 (#14) is independent and trivial.
- **Cross-component test (HANDOFF §5 — integration gaps slip past component gates):** a Playwright test
  that edits a setting in the drawer and asserts the board reflects it live — spanning
  config → emitter → scene → render. Component gates alone would miss the wiring.

## Collaboration points (need the user, not an agent)

- **Game-code picker semantics** (#13): what "saved" codes are (recent? named favorites?) and the random
  format. Confirm before building step 7.
- **CSS look** (#16): best-effort first pass, then iterate live together.

## Verification (per gate)

Lint clean · coverage 100% on pure files · mutation ≥ threshold on `mutateScope` (steps 1,2,9 + pure
models) · Playwright green for glue · every gate proven to *bite* (inject a regression → non-zero exit,
restore). Independently re-run metrics; re-run any flaky metric ≥2×.
