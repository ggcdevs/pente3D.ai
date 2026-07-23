/**
 * Network-Game drawer panel widget (issue #13 / #16; unified entry — S.6, epic #35, closes #31) — the
 * DOM/dispatch + input-scope IO glue for the pure {@link deriveNetPanel} view-model (`netPanelModel.ts`).
 *
 * It relocates the game-ENTRY initiation out of the always-on `connectionStatus` overlay INTO the
 * non-blocking drawer (issue #13 / #24): the menu's "Network Game" entry dispatches `openNetwork`,
 * which opens THIS panel. The Host-vs-Join UX is REPLACED (design §3) by ONE game-code COMBOBOX (the
 * room CODE = a rendezvous channel, GLOSSARY "Room / code") — a text input plus a dropdown of
 * recently-used codes — PLUS a SEED SELECTOR choosing what GAME to bring (New / Resume / Current local
 * board / Dealer's choice; Randomized is #34, deliberately absent), and a SINGLE **Enter** button that
 * carries the chosen code + seed into the session's `enter(code, proposal)` seam. It reuses Increment
 * B's non-blocking-panel-in-drawer pattern EXACTLY (mirrors `settings.ts`): opening PUSHES a
 * NON-blocking scope ({@link NET_PANEL_SCOPE_BLOCKING} === false) so the board stays interactive under
 * it, and closing POPS it — every close path (Escape, outside-click, the ✕ button, Enter) pops exactly
 * once, so the stack never leaks.
 *
 * The combobox input shows a FRESH random code as its PLACEHOLDER (generated via `generateGameCode`
 * when the panel opens — greyed, NOT the value). The EFFECTIVE code Enter acts on is the typed text
 * when non-empty, else that placeholder. The dropdown lists the recent codes (newest-first from the
 * C.1 store); clicking a row fills the input, and each row's remove control deletes just that code.
 * The seed selector offers the four kinds; `Resume` reveals a simple list of persisted games (the
 * rich games list is #37) supplied by the glue's {@link NetPanelDeps.seedSources}. All DECISIONS
 * (effective code, validation, seed actionability, the canonical seed choice, Enter enablement) live
 * in the pure model; this file only paints the model onto DOM, forwards clicks, generates the random
 * placeholder via the injected rng, reads the seed sources, and mutates the C.1 store.
 *
 * On Enter it records the used code into the C.1 recent-codes store (`recordRecentCode`) and hands the
 * canonical code + the resolved admission {@link Proposal} to {@link NetPanelDeps.enter} (which the app
 * wires to `NetSession.enter` — S.5). It does NOT reimplement the net session/transport. It touches
 * `document`, so it is the Playwright-verified IO boundary (asserted on `window.__pente` getNet() +
 * real interactions + screenshots), not unit/mutation-gated. `data-testid`s expose the rendered model
 * + open state for readback (agent-principles #3: observable behavior).
 */

import type { Widget, WidgetFactory } from '../registry.ts';
import { generateGameCode } from './netModel.ts';
import type { Proposal } from '../../net/admission.ts';
import { listRecentCodes, recordRecentCode, removeRecentCode } from './recentCodes.ts';
import {
  initialNetPanel,
  setPanelText,
  chooseRecent,
  removeRecent,
  setSeedKind,
  chooseResume,
  deriveNetPanel,
  type NetPanelState,
  type SeedSources,
  type SeedGame,
  type SeedKind,
} from './netPanelModel.ts';

/** The stable widget id — matches the `networkGame` entry in the tracked `layout` default. */
export const NET_PANEL_WIDGET_ID = 'networkGame';

/** The stable input scope id the open panel pushes. */
export const NET_PANEL_SCOPE_ID = 'networkGame';

/**
 * Whether the panel's scope BLOCKS unhandled keys. `false` (non-blocking, #24 / Increment B): the
 * panel opens WITHIN the drawer context over the LIVE board, so unbound keys fall THROUGH to the
 * camera/game scopes below and the board stays interactive while you pick a code. Mirrors the
 * settings panel's blocking policy exactly. A single named constant so the policy is one testable
 * fact, not a literal buried in the glue.
 */
export const NET_PANEL_SCOPE_BLOCKING = false;

/** A minimal scope shape the widget pushes (mirrors `input/scopes.ts` `Scope`, as settings/menu do). */
export interface NetPanelScope {
  readonly id: string;
  readonly bindings: Readonly<Record<string, string>>;
  readonly blocking: boolean;
}

/**
 * The deps the Network-Game panel needs. Mirrors the settings/net widgets: a document (injected for
 * testability), the scope-stack `pushScope`/`popScope` (the open panel pushes/pops the non-blocking
 * `networkGame` scope), `registerOpenNetwork` (the widget hands its `open()` back so the `openNetwork`
 * command opens it), `seedSources` (the resume-able persisted games + whether a current local game
 * exists — read fresh on each open so the seed selector reflects the live archive), and `enter` (the
 * S.6 unified-entry seam the app wires to `NetSession.enter(code, proposal)`).
 */
export interface NetPanelDeps {
  readonly doc: Document;
  /** Push the NON-blocking `networkGame` scope when the panel opens (board stays live under it). */
  pushScope(scope: NetPanelScope): void;
  /** Pop the topmost input scope (the `networkGame` scope) when the panel closes. */
  popScope(): void;
  /** Register the widget's `open()` so the `openNetwork` command opens this panel. */
  registerOpenNetwork(open: () => void): void;
  /**
   * The seed sources to offer when the panel opens (design §3): the resume-able persisted games (a
   * simple list — the rich games list is #37) and whether a live local game exists (so `current` is
   * offerable). Read fresh on each open so the selector reflects the current archive + board.
   */
  seedSources(): SeedSources;
  /**
   * The currently-loaded local game's identity (`uuid` + `headHash`) for the `current` seed proposal,
   * or `null` if there is no live local game. Read at Enter time (design §3 "Current local board").
   * Kept off {@link SeedSources} (which the pure model reads) so the model only knows WHETHER a current
   * game exists (`hasCurrent`), never its identity — the identity resolution stays in this IO glue.
   */
  currentGame(): { readonly uuid: string; readonly headHash: string } | null;
  /**
   * Enter a room with a canonical `code` and the chosen seed `proposal` (design §3/§4). The app wires
   * this to `NetSession.enter` (S.5): the single unified-entry action that replaces the old Host/Join
   * commands. The panel only ever passes a canonical (validated) code + a resolved proposal.
   */
  enter(code: string, proposal: Proposal): void;
}

/** Build the NON-blocking `networkGame` scope the open panel pushes (mirrors the settings scope). */
function netPanelScope(): NetPanelScope {
  return { id: NET_PANEL_SCOPE_ID, bindings: {}, blocking: NET_PANEL_SCOPE_BLOCKING };
}

/**
 * Build the Network-Game-panel {@link WidgetFactory}. The mounted element is a hidden left-edge
 * drawer panel (no visible trigger — opened by the `openNetwork` command). It is (re)populated from
 * the pure model each time it opens (a fresh random placeholder + the current recent codes), so the
 * dropdown always reflects the current store and a fresh code is offered each open.
 */
export function netPanelWidget(): WidgetFactory {
  return {
    id: NET_PANEL_WIDGET_ID,
    mount(rawDeps: unknown): Widget {
      const deps = rawDeps as NetPanelDeps;
      const doc = deps.doc;

      // Root is the LEFT-edge slide-in panel (slid off-screen + hidden until opened, mirroring the
      // settings modal). Toggled by the `--open` class (NOT `[hidden]`/`display:none`, not animatable).
      const element = doc.createElement('div');
      element.className = 'pente-netpanel-modal';
      element.setAttribute('data-testid', 'netpanel-modal');
      element.setAttribute('role', 'dialog');
      element.setAttribute('aria-label', 'Network Game');

      const panel = doc.createElement('div');
      panel.className = 'pente-netpanel-panel';

      const title = doc.createElement('div');
      title.className = 'pente-netpanel-title';
      title.textContent = 'Network Game';
      panel.appendChild(title);

      const closeButton = doc.createElement('button');
      closeButton.className = 'pente-netpanel-close';
      closeButton.setAttribute('data-testid', 'netpanel-close');
      closeButton.setAttribute('aria-label', 'Close network game');
      closeButton.textContent = '✕';
      panel.appendChild(closeButton);

      // --- The unified combobox: a text input + a dropdown-toggle chevron. -------------------------
      const combo = doc.createElement('div');
      combo.className = 'pente-netpanel-combo';

      const codeInput = doc.createElement('input');
      codeInput.type = 'text';
      codeInput.className = 'pente-netpanel-code-input';
      codeInput.setAttribute('data-testid', 'netpanel-code-input');
      codeInput.setAttribute('aria-label', 'Game code');
      codeInput.setAttribute('autocomplete', 'off');
      combo.appendChild(codeInput);

      const toggle = doc.createElement('button');
      toggle.type = 'button';
      toggle.className = 'pente-netpanel-toggle';
      toggle.setAttribute('data-testid', 'netpanel-toggle');
      toggle.setAttribute('aria-label', 'Show recent codes');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-controls', 'netpanel-recent-list');
      toggle.textContent = '▾';
      combo.appendChild(toggle);

      panel.appendChild(combo);

      // --- The recent-codes dropdown (revealed by the toggle). ------------------------------------
      const recentList = doc.createElement('ul');
      recentList.className = 'pente-netpanel-recent';
      recentList.id = 'netpanel-recent-list';
      recentList.setAttribute('data-testid', 'netpanel-recent');
      recentList.setAttribute('role', 'listbox');
      recentList.setAttribute('aria-label', 'Recent game codes');
      recentList.hidden = true;
      panel.appendChild(recentList);

      // --- Inline validation error (invalid typed code). -----------------------------------------
      const error = doc.createElement('div');
      error.className = 'pente-netpanel-error';
      error.setAttribute('data-testid', 'netpanel-error');
      error.hidden = true;
      panel.appendChild(error);

      // --- The seed selector: WHAT game to bring (New / Resume / Current / Dealer's). -------------
      const seedGroup = doc.createElement('div');
      seedGroup.className = 'pente-netpanel-seed';
      seedGroup.setAttribute('data-testid', 'netpanel-seed');
      seedGroup.setAttribute('role', 'radiogroup');
      seedGroup.setAttribute('aria-label', 'What game to bring');
      panel.appendChild(seedGroup);

      // Per-kind seed buttons, keyed so render() can flip their selected/disabled/label state. Built
      // once from the model's option rows so their order + labels are the pure model's SSOT.
      const seedButtons = new Map<SeedKind, HTMLButtonElement>();
      for (const opt of deriveNetPanel(initialNetPanel('', [], { games: [], hasCurrent: false }))
        .seedOptions) {
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'pente-netpanel-seed-option';
        btn.setAttribute('data-testid', `netpanel-seed-${opt.kind}`);
        btn.setAttribute('role', 'radio');
        btn.setAttribute('data-seed-kind', opt.kind);
        btn.textContent = opt.label;
        btn.addEventListener('click', () => selectSeed(opt.kind));
        seedButtons.set(opt.kind, btn);
        seedGroup.appendChild(btn);
      }

      // --- The resume games list (revealed only when the Resume seed is selected). ----------------
      const gamesList = doc.createElement('ul');
      gamesList.className = 'pente-netpanel-games';
      gamesList.setAttribute('data-testid', 'netpanel-games');
      gamesList.setAttribute('role', 'listbox');
      gamesList.setAttribute('aria-label', 'Games to resume');
      gamesList.hidden = true;
      panel.appendChild(gamesList);

      // --- The single Enter action (carries the code + the chosen seed proposal). -----------------
      const actions = doc.createElement('div');
      actions.className = 'pente-netpanel-actions';
      const enterButton = doc.createElement('button');
      enterButton.className = 'pente-netpanel-enter';
      enterButton.setAttribute('data-testid', 'netpanel-enter');
      enterButton.textContent = 'Enter';
      actions.appendChild(enterButton);
      panel.appendChild(actions);

      element.appendChild(panel);

      let open = false;
      let dropdownOpen = false;
      // The panel state (the single source of truth the pure model reads). Rebuilt on each open.
      let state: NetPanelState = initialNetPanel(generateGameCode(Math.random), listRecentCodes(), {
        games: [],
        hasCurrent: false,
      });

      /** Rebuild the DOM from the pure model derived off the combobox state. */
      function render(): void {
        const model = deriveNetPanel(state);

        // The input shows the raw typed text as its VALUE and the fresh random code as its PLACEHOLDER
        // (greyed, not the value) — an untouched input hosts/joins the placeholder (agent-principles
        // #3: the placeholder is observable via the input's `placeholder` attribute).
        if (codeInput.value !== model.text) codeInput.value = model.text;
        codeInput.setAttribute('placeholder', model.placeholder);

        // Rebuild the dropdown rows: each row is a clickable code + a remove control.
        recentList.replaceChildren();
        for (const row of model.recentRows) {
          recentList.appendChild(recentRow(doc, row.code, chooseCode, removeCode));
        }
        toggle.disabled = model.recentRows.length === 0;

        // Error line comes straight from the pure model.
        if (model.codeError !== null) {
          error.textContent = model.codeError;
          error.hidden = false;
        } else {
          error.textContent = '';
          error.hidden = true;
        }

        // Seed options: selected + availability (disabled) reflect the pure model. A non-available
        // option is still shown (so the user sees WHY Enter is blocked) but disabled.
        for (const opt of model.seedOptions) {
          const btn = seedButtons.get(opt.kind);
          if (btn === undefined) continue;
          btn.disabled = !opt.available;
          btn.setAttribute('aria-checked', String(opt.selected));
          btn.setAttribute('data-selected', String(opt.selected));
        }

        // The resume games list is only shown (and populated) when the Resume seed is selected.
        gamesList.replaceChildren();
        for (const row of model.seedGameRows) {
          gamesList.appendChild(gameRow(doc, row.id, row.label, row.selected, chooseGame));
        }
        gamesList.hidden = model.seedKind !== 'resume';

        // Enter enablement = a valid code AND an actionable seed (both from the pure model).
        enterButton.disabled = !model.canEnter;
        element.setAttribute('data-code-valid', String(model.codeValid));
        element.setAttribute('data-recent-count', String(model.recentRows.length));
        element.setAttribute('data-seed-kind', model.seedKind);
        element.setAttribute('data-seed-actionable', String(model.seedActionable));
        element.setAttribute('data-can-enter', String(model.canEnter));
      }

      /** Show/hide the recent dropdown (reflected on the toggle's aria-expanded). */
      function setDropdown(nextOpen: boolean): void {
        dropdownOpen = nextOpen;
        recentList.hidden = !nextOpen;
        toggle.setAttribute('aria-expanded', String(nextOpen));
        element.setAttribute('data-dropdown-open', String(nextOpen));
      }

      /** Fill the input from a chosen recent code, then collapse the dropdown. */
      function chooseCode(code: string): void {
        state = chooseRecent(state, code);
        render();
        setDropdown(false);
        codeInput.focus();
      }

      /** Remove a recent code from BOTH the C.1 store and the rendered model, keeping them in sync. */
      function removeCode(code: string): void {
        removeRecentCode(code);
        state = removeRecent(state, code);
        render();
        // Collapse if the list just emptied (the toggle is now disabled and nothing is left to show).
        if (state.recent.length === 0) setDropdown(false);
      }

      /** Select a seed KIND (New / Resume / Current / Dealer's). A disabled option never reaches here. */
      function selectSeed(kind: SeedKind): void {
        state = setSeedKind(state, kind);
        render();
      }

      /** Pick a specific resume game by its archive id, then repaint (picks the game + resume kind). */
      function chooseGame(id: string): void {
        state = chooseResume(state, id);
        render();
      }

      // --- Wiring ---------------------------------------------------------------------------------
      codeInput.addEventListener('input', () => {
        state = setPanelText(state, codeInput.value);
        render();
      });
      toggle.addEventListener('click', () => {
        if (toggle.disabled) return;
        setDropdown(!dropdownOpen);
      });

      enterButton.addEventListener('click', () => enterRoom());

      /**
       * ENTER the room with the canonical code + the resolved seed proposal (design §3/§4). Records the
       * code into the recent-codes store, resolves the pure model's {@link SeedChoice} into an admission
       * {@link Proposal} (mapping the chosen resume game's id → its uuid/headHash from the seed sources),
       * closes the panel (pops our scope), then hands the code + proposal to {@link NetPanelDeps.enter}.
       * Guarded by the model — a disabled Enter never fires — but the guard is defensive
       * (agent-principles: never hand an empty/malformed code or an incomplete seed to the transport).
       */
      function enterRoom(): void {
        const model = deriveNetPanel(state);
        if (model.canonicalCode === null || model.seedChoice === null) return; // Enter is disabled.
        const proposal = resolveProposal(
          model.seedChoice.kind,
          model.seedChoice.resumeId,
          state.games,
          deps.currentGame(),
        );
        if (proposal === null) return; // a resume/current game that no longer resolves — never half-formed.
        const canonical = model.canonicalCode;
        recordRecentCode(canonical);
        // Close FIRST (pop our scope) THEN enter, mirroring the menu: downstream sees a clean stack.
        close();
        deps.enter(canonical, proposal);
      }

      function onKeyDown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }

      /** Close on a click OUTSIDE the panel (no backdrop — mirrors the settings/menu outside-click). */
      function onOutsidePointer(event: Event): void {
        const target = event.target as Node | null;
        if (target !== null && panel.contains(target)) return;
        close();
      }

      function openPanel(): void {
        if (open) return; // idempotent — a second open must not push a second scope
        open = true;
        // Fresh panel each open: a fresh random placeholder, the recent list re-read, the seed sources
        // (resume-able games + whether a current local game exists) re-read from the live archive/board.
        state = initialNetPanel(generateGameCode(Math.random), listRecentCodes(), deps.seedSources());
        setDropdown(false);
        render();
        element.classList.add('pente-netpanel-modal--open');
        element.setAttribute('data-open', 'true');
        deps.pushScope(netPanelScope());
        doc.addEventListener('keydown', onKeyDown);
        doc.addEventListener('pointerdown', onOutsidePointer, true);
      }

      function close(): void {
        if (!open) return; // idempotent — closing when closed must not pop a scope
        open = false;
        setDropdown(false);
        element.classList.remove('pente-netpanel-modal--open');
        element.setAttribute('data-open', 'false');
        doc.removeEventListener('keydown', onKeyDown);
        doc.removeEventListener('pointerdown', onOutsidePointer, true);
        deps.popScope();
      }

      closeButton.addEventListener('click', () => close());
      element.setAttribute('data-open', 'false');

      // Hand our opener to the shell so the `openNetwork` command opens this panel.
      deps.registerOpenNetwork(openPanel);

      return {
        element,
        // The panel is driven by its own combobox state, not the game state — `update` is a no-op (the
        // open panel is rebuilt from the store on open; nothing to repaint on a board change).
        update(): void {},
        dispose(): void {
          if (open) close();
        },
      };
    },
  };
}

/**
 * Build one recent-code dropdown row: a clickable code cell (fills the input) plus a remove control
 * (drops just that code). The remove button carries an accessible label naming the code it removes.
 */
function recentRow(
  doc: Document,
  code: string,
  onChoose: (code: string) => void,
  onRemove: (code: string) => void,
): HTMLLIElement {
  const li = doc.createElement('li');
  li.className = 'pente-netpanel-recent-row';
  li.setAttribute('role', 'option');
  li.setAttribute('data-testid', 'netpanel-recent-row');
  li.setAttribute('data-code', code);

  const codeBtn = doc.createElement('button');
  codeBtn.type = 'button';
  codeBtn.className = 'pente-netpanel-recent-code';
  codeBtn.setAttribute('data-testid', 'netpanel-recent-code');
  codeBtn.textContent = code;
  codeBtn.addEventListener('click', () => onChoose(code));
  li.appendChild(codeBtn);

  const removeBtn = doc.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'pente-netpanel-recent-remove';
  removeBtn.setAttribute('data-testid', 'netpanel-recent-remove');
  removeBtn.setAttribute('aria-label', `Remove ${code} from recent codes`);
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', () => onRemove(code));
  li.appendChild(removeBtn);

  return li;
}

/**
 * Build one resume-game row: a clickable cell (picks the game to resume) carrying its archive id +
 * label + selected flag. Clicking hands the id back so the widget resumes exactly that game.
 */
function gameRow(
  doc: Document,
  id: string,
  label: string,
  selected: boolean,
  onChoose: (id: string) => void,
): HTMLLIElement {
  const li = doc.createElement('li');
  li.className = 'pente-netpanel-game-row';
  li.setAttribute('role', 'option');
  li.setAttribute('data-testid', 'netpanel-game-row');
  li.setAttribute('data-game-id', id);
  li.setAttribute('aria-selected', String(selected));
  li.setAttribute('data-selected', String(selected));

  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'pente-netpanel-game';
  btn.setAttribute('data-testid', 'netpanel-game');
  btn.textContent = label;
  btn.addEventListener('click', () => onChoose(id));
  li.appendChild(btn);

  return li;
}

/**
 * Resolve a pure {@link SeedKind} + optional chosen resume id into the concrete admission
 * {@link Proposal} the session's `enter()` consumes (design §4): `new` → `{ kind: 'new' }`; `defer` →
 * `{ kind: 'defer' }`; `resume` → the chosen game's `uuid` + `headHash` (looked up in the seed games);
 * `current` → the live local game's `uuid` + `headHash` (from `currentGame`, kept out of the resume
 * list). Returns `null` if a `resume`/`current` game cannot be resolved (a stale id, or `current` with
 * no live game) — the caller then never enters half-formed (agent-principles: honest, never a masked
 * bad proposal). The model already gates Enter on actionability, so `null` here is the defensive
 * backstop for a source that changed between selection and Enter.
 */
function resolveProposal(
  kind: SeedKind,
  resumeId: string | null,
  games: readonly SeedGame[],
  currentGame: { readonly uuid: string; readonly headHash: string } | null,
): Proposal | null {
  switch (kind) {
    case 'new':
      return { kind: 'new' };
    case 'defer':
      return { kind: 'defer' };
    case 'current':
      return currentGame === null
        ? null
        : { kind: 'current', uuid: currentGame.uuid, headHash: currentGame.headHash };
    case 'resume': {
      const g = resumeId === null ? undefined : games.find((row) => row.id === resumeId);
      return g === undefined ? null : { kind: 'resume', uuid: g.uuid, headHash: g.headHash };
    }
  }
}
