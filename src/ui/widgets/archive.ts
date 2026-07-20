/**
 * Archive-browser widget (Task 5.8) — the DOM/dispatch + IndexedDB IO glue for the pure
 * {@link deriveArchive} view-model (`archiveModel.ts`). Render-ui design Part 6 "Widget roster:
 * menu (… Load …)"; GLOSSARY "Game archive". This is the persistence-UX front door: it reviews the
 * Stage 2 archive (past + conflicted games) and loads a chosen game back into the scene.
 *
 * A self-contained widget by the design-Part-6 contract: a stable string id (`archiveBrowser`, the
 * id the tracked `layout` default places), `mount() → DOM element`, `update(...)`, knowing NOTHING
 * about its placement (the zone-based `layout` config drives that). Like the settings/help modals it
 * has NO visible trigger of its own — it is opened by the `loadGame` COMMAND (design Principle 3:
 * the menu's "Load" entry and any keybinding dispatch that identical id). At mount the widget hands
 * its `open()` to `deps.registerOpenArchive`, which the shell forwards to the scene's `setOpenArchive`.
 *
 * The list is READ FROM THE ARCHIVE, never hardcoded: on every open the widget awaits
 * `deps.listArchive()` (the app's `listArchivedGames` over IndexedDB) and paints `deriveArchive(...)`'s
 * newest-first rows. Choosing a row calls `deps.loadArchived(id)` (the app's archive→scene load path),
 * which reconstructs the stored game (folding its event log) and swaps it into the scene for review —
 * observable via `window.__pente` getState/getHistory (agent-principles #3: behavior, not a log line).
 * A conflicted row is marked (GLOSSARY "conflict") so the user sees a forked game is special.
 *
 * The open modal is a MODE change in the input layer: opening PUSHES a `blocking` scope
 * (GLOSSARY "Blocking scope") and closing POPS it — every close path (Escape, outside-click, the ✕
 * button, choosing a row) pops exactly once, so the stack never leaks. It touches `document` +
 * IndexedDB, so it is the Playwright-verified IO boundary (asserted on `window.__pente` getState/
 * getHistory + the rendered rows + real interactions), not unit/mutation-gated. `data-testid`s +
 * `data-*` expose the rendered model + open state for readback.
 */

import type { Widget, WidgetFactory } from '../registry.ts';
import { deriveArchive, type ArchiveListing } from './archiveModel.ts';

/** The stable widget id — matches the `archiveBrowser` entry in the tracked `layout` default. */
export const ARCHIVE_WIDGET_ID = 'archiveBrowser';

/** The stable input scope id the open modal pushes — a BLOCKING scope (GLOSSARY "Blocking scope"). */
export const ARCHIVE_SCOPE_ID = 'archive';

/** A minimal blocking scope shape the widget pushes (mirrors `input/scopes.ts` `Scope` without
 * importing it, exactly as the menu/settings/help widgets do). No bindings: it swallows every key. */
export interface ArchiveScope {
  readonly id: string;
  readonly bindings: Readonly<Record<string, string>>;
  readonly blocking: true;
}

/**
 * The deps an archive-browser needs: a document to build in (injected for testability), the
 * scope-stack `pushScope`/`popScope` (the open modal pushes/pops the blocking `archive` scope),
 * `registerOpenArchive` (the widget hands its `open()` back so the `loadGame` command can call it),
 * and the two archive IO seams the app supplies (so the widget never opens IndexedDB itself):
 * `listArchive()` (the app's `listArchivedGames`) and `loadArchived(id)` (reconstruct + swap into
 * the scene). Both are async — reading/loading an archive is a promise (IndexedDB).
 */
export interface ArchiveDeps {
  readonly doc: Document;
  /** Push the blocking `archive` scope when the modal opens. */
  pushScope(scope: ArchiveScope): void;
  /** Pop the topmost input scope (the `archive` scope) when the modal closes. */
  popScope(): void;
  /** Register the widget's `open()` so the `loadGame` command opens this modal. */
  registerOpenArchive(open: () => void): void;
  /** List every archived game as `{ id, meta }` (no logs), newest-first is the model's job. */
  listArchive(): Promise<readonly ArchiveListing[]>;
  /** Reconstruct the archived game `id` and swap it into the scene for review. */
  loadArchived(id: string): Promise<void>;
}

/** Build the blocking `archive` scope the open modal pushes (id `archive`, no bindings). */
function archiveScope(): ArchiveScope {
  return { id: ARCHIVE_SCOPE_ID, bindings: {}, blocking: true };
}

/**
 * Build the archive-browser {@link WidgetFactory}. The mounted element is a hidden modal overlay
 * (no visible trigger — opened by the `loadGame` command). Its rows are (re)read from the archive
 * each time it opens, so a game autosaved or conflicted since the last open is reflected.
 */
export function archiveWidget(): WidgetFactory {
  return {
    id: ARCHIVE_WIDGET_ID,
    mount(rawDeps: unknown): Widget {
      const deps = rawDeps as ArchiveDeps;
      const doc = deps.doc;

      // Root is the modal overlay itself (hidden until opened). Placement is irrelevant — it is a
      // fixed full-viewport overlay — but it still mounts into its layout zone as a widget.
      const element = doc.createElement('div');
      element.className = 'pente-archive-modal';
      element.setAttribute('data-testid', 'archive-modal');
      element.setAttribute('role', 'dialog');
      element.setAttribute('aria-label', 'Saved games');
      element.hidden = true;

      const panel = doc.createElement('div');
      panel.className = 'pente-archive-panel';

      const title = doc.createElement('div');
      title.className = 'pente-archive-title';
      title.textContent = 'Saved games';
      panel.appendChild(title);

      const closeButton = doc.createElement('button');
      closeButton.className = 'pente-archive-close';
      closeButton.setAttribute('data-testid', 'archive-close');
      closeButton.setAttribute('aria-label', 'Close saved games');
      closeButton.textContent = '✕';
      panel.appendChild(closeButton);

      // The rows body is (re)populated from the archive each open. An explicit empty-state element
      // is shown when there are no saved games (the pure model's `isEmpty` flag).
      const body = doc.createElement('div');
      body.className = 'pente-archive-body';
      body.setAttribute('data-testid', 'archive-rows');
      panel.appendChild(body);

      const empty = doc.createElement('div');
      empty.className = 'pente-archive-empty';
      empty.setAttribute('data-testid', 'archive-empty');
      empty.textContent = 'No saved games yet.';
      empty.hidden = true;
      panel.appendChild(empty);

      element.appendChild(panel);

      let open = false;

      /** Rebuild the game rows from the pure model derived off the archive listings. */
      async function renderRows(): Promise<void> {
        const listings = await deps.listArchive();
        const model = deriveArchive(listings);
        body.replaceChildren();
        empty.hidden = !model.isEmpty;
        element.setAttribute('data-empty', String(model.isEmpty));
        element.setAttribute('data-count', String(model.items.length));

        for (const item of model.items) {
          const row = doc.createElement('button');
          row.className = 'pente-archive-row';
          row.setAttribute('data-testid', `archive-row-${item.id}`);
          row.setAttribute('data-id', item.id);
          row.setAttribute('data-conflicted', String(item.conflicted));
          row.setAttribute('data-result', item.result);
          row.setAttribute('data-head-hash', item.headHash);
          row.setAttribute('data-started-at', String(item.startedAt));

          const players = doc.createElement('span');
          players.className = 'pente-archive-players';
          players.textContent = item.playersLabel;
          row.appendChild(players);

          const meta = doc.createElement('span');
          meta.className = 'pente-archive-meta';
          // A conflicted game is called out explicitly (GLOSSARY "conflict"); otherwise the raw
          // result marker is shown. The date is formatted from the epoch millis for the human.
          meta.textContent = item.conflicted
            ? `Conflicted · ${formatDate(item.startedAt)}`
            : `${item.result} · ${formatDate(item.startedAt)}`;
          row.appendChild(meta);

          // Choosing a row loads that game into the scene for review, then closes the modal (which
          // pops the blocking scope exactly once). We close FIRST so the scope is popped before the
          // async load resolves — the review happens against the game/camera scopes, not under a
          // stale blocking modal scope.
          row.addEventListener('click', () => {
            close();
            void deps.loadArchived(item.id);
          });
          body.appendChild(row);
        }
      }

      function onKeyDown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }

      /** Close on a click OUTSIDE the panel (the backdrop overlay). */
      function onOutsidePointer(event: Event): void {
        const target = event.target as Node | null;
        if (target !== null && panel.contains(target)) return;
        close();
      }

      function openModal(): void {
        if (open) return; // idempotent — a second open must not push a second scope
        open = true;
        element.hidden = false;
        element.setAttribute('data-open', 'true');
        deps.pushScope(archiveScope());
        doc.addEventListener('keydown', onKeyDown);
        doc.addEventListener('pointerdown', onOutsidePointer, true);
        // Read the archive AFTER showing the modal so the panel appears immediately; the rows fill in
        // when the (async) IndexedDB read resolves. A read failure is surfaced honestly (never a
        // silent empty list masquerading as "no games").
        void renderRows();
      }

      function close(): void {
        if (!open) return; // idempotent — closing when closed must not pop a scope
        open = false;
        element.hidden = true;
        element.setAttribute('data-open', 'false');
        doc.removeEventListener('keydown', onKeyDown);
        doc.removeEventListener('pointerdown', onOutsidePointer, true);
        deps.popScope();
      }

      closeButton.addEventListener('click', () => close());
      element.setAttribute('data-open', 'false');

      // Hand our opener to the shell so the `loadGame` command opens this modal.
      deps.registerOpenArchive(openModal);

      return {
        element,
        // The archive reads listings on open, not on every board change — `update` is a no-op.
        update(): void {},
        dispose(): void {
          if (open) close();
        },
      };
    },
  };
}

/** Format an epoch-millis timestamp as a locale date-time for a row's human-readable label. */
function formatDate(startedAt: number): string {
  return new Date(startedAt).toLocaleString();
}
