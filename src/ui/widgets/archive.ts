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
 * newest-first rows. Each row offers up to two actions (Task 6.6, review vs resume), driven by the pure
 * model's `canReview`/`canResume` flags: REVIEW (`deps.reviewArchived(id)`) reconstructs the stored game
 * and swaps it into the scene READ-ONLY (browse via the history slider), and RESUME
 * (`deps.resumeArchived(uuid)`) swaps it in and makes it the live CONTINUABLE game. Resume is offered
 * ONLY for a resumable (unfinished) game; a finished or conflicted row shows Review only — both
 * observable via `window.__pente` getState/getHistory + the rendered buttons (agent-principles #3:
 * behavior, not a log line). A conflicted row is marked (GLOSSARY "conflict") so the user sees a forked
 * game is special.
 *
 * **Task V.6 (epic #47, ticket #37).** v3.1 deletes the code→game mapping and lands every reload on an
 * empty slate, so this browser is the ONLY route back to a game (design §6/§10). Two extensions follow,
 * both decided in the pure model and merely painted here:
 *   - the rows are SECTIONED by status — `Unfinished` first (rendered even when empty, with the model's
 *     note, so "nothing to resume" is stated), then `Finished`, then `Conflicted`;
 *   - RESUME is keyed by the GAME's portable `uuid` (design §2.2), not the record id — a record key is
 *     not always its game's identity (a conflicted record, a pre-V.5 record awaiting the boot re-key).
 *     Each row publishes its `data-game-uuid` so a test can prove the row and the loaded game are the
 *     same GAME;
 *   - a REFUSED resume SAYS SO: `resumeArchived` resolves a typed outcome, the modal closes only when
 *     the game actually landed, and a refusal paints the model's reason
 *     (`archiveModel.RESUME_REFUSAL_TEXT`) into `[data-testid="archive-refusal"]`. Before that the
 *     modal closed first and every refusal was a `log.error` nobody could see — clicking Resume on a
 *     stale row, or while a room was running, did nothing at all.
 *
 * The open modal is a MODE change in the input layer: opening PUSHES a `blocking` scope
 * (GLOSSARY "Blocking scope") and closing POPS it — every close path (Escape, outside-click, the ✕
 * button, choosing a row) pops exactly once, so the stack never leaks. It touches `document` +
 * IndexedDB, so it is the Playwright-verified IO boundary (asserted on `window.__pente` getState/
 * getHistory + the rendered rows + real interactions), not unit/mutation-gated. `data-testid`s +
 * `data-*` expose the rendered model + open state for readback.
 */

import type { Widget, WidgetFactory } from '../registry.ts';
import {
  deriveArchive,
  RESUME_REFUSAL_TEXT,
  type ArchiveItem,
  type ArchiveListing,
  type ResumeOutcome,
} from './archiveModel.ts';

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
 * and the archive IO seams the app supplies (so the widget never opens IndexedDB itself):
 * `listArchive()` (the app's `listArchivedGames`) plus the two DISTINCT load paths (Task 6.6):
 * `reviewArchived(id)` loads a game read-only by its RECORD id (browse via the history slider) and
 * `resumeArchived(uuid)` loads it by the GAME's uuid to CONTINUE PLAYING (Task V.6 — the two keys are
 * not always the same). All async — reading/loading an archive is a promise (IndexedDB).
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
  /**
   * REVIEW (Task 6.6): reconstruct the archived game `id` and swap it into the scene read-only, so the
   * user can browse its history via the slider. Does not re-mint the autosave id — reviewing an old
   * game must not disturb the current autosave record.
   */
  reviewArchived(id: string): Promise<void>;
  /**
   * RESUME (Task 6.6; keyed by GAME UUID since Task V.6): reconstruct the game whose portable
   * `uuid` this is (design §2.2 — NOT the record id, which a conflicted or pre-V.5 record does not
   * share with its game), swap it into the scene, and make it the live continuable game. Continued
   * play is written back to the RECORD the game was loaded from. Only offered for a resumable
   * (unfinished) row.
   *
   * Resolves an {@link ResumeOutcome}, NOT `void`: a resume can be refused (a stale row, a game a
   * live room is running, a damaged record), and the widget has to be able to SAY so. When this
   * resolved `void`, every refusal was a log line behind a modal that had already closed — the
   * player clicked Resume and nothing happened at all.
   */
  resumeArchived(uuid: string): Promise<ResumeOutcome>;
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

      // WHY A RESUME DID NOT HAPPEN, said out loud. A refusal keeps the modal OPEN and paints the
      // model's reason text here, so the player sees an answer where they clicked instead of a list
      // that closes onto an unchanged board (agent-principles #1/#3 — observable behavior, not a log).
      const refusal = doc.createElement('div');
      refusal.className = 'pente-archive-refusal';
      refusal.setAttribute('data-testid', 'archive-refusal');
      refusal.setAttribute('role', 'alert');
      refusal.hidden = true;
      panel.appendChild(refusal);

      element.appendChild(panel);

      let open = false;

      /** Paint (or clear) the refusal notice — the ONE place the modal says why nothing loaded. */
      function showRefusal(text: string | null): void {
        refusal.textContent = text ?? '';
        refusal.hidden = text === null;
        element.setAttribute('data-refusal', text ?? '');
      }

      /** Build one game row (Task 5.8 / 6.6 / V.6) from a resolved model item. */
      function buildRow(item: ArchiveItem): HTMLElement {
        const row = doc.createElement('div');
        row.className = 'pente-archive-row';
        row.setAttribute('data-testid', `archive-row-${item.id}`);
        row.setAttribute('data-id', item.id);
        // The GAME's portable identity (Task V.6, design §2.2) — what RESUME is keyed by, and what a
        // test reads to prove the row and the loaded game are the same GAME, not merely the same key.
        row.setAttribute('data-game-uuid', item.uuid);
        row.setAttribute('data-status', item.status);
        row.setAttribute('data-conflicted', String(item.conflicted));
        row.setAttribute('data-result', item.result);
        row.setAttribute('data-head-hash', item.headHash);
        row.setAttribute('data-started-at', String(item.startedAt));
        // Expose the action affordances so Playwright can prove a finished/conflicted row offers
        // NO resume (observable, not a log line — agent-principles #3), from the pure model flags.
        row.setAttribute('data-can-review', String(item.canReview));
        row.setAttribute('data-can-resume', String(item.canResume));

        const players = doc.createElement('span');
        players.className = 'pente-archive-players';
        players.textContent = item.playersLabel;
        row.appendChild(players);

        const meta = doc.createElement('span');
        meta.className = 'pente-archive-meta';
        // The row states its STATUS in words (Task V.6 — the browse axis #37 asks for), and a
        // FINISHED game additionally names its outcome (which side won). The date is formatted from
        // the epoch millis for the human.
        meta.textContent =
          item.status === 'finished'
            ? `${item.statusLabel} · ${item.result} · ${formatDate(item.startedAt)}`
            : `${item.statusLabel} · ${formatDate(item.startedAt)}`;
        row.appendChild(meta);

        const actions = doc.createElement('span');
        actions.className = 'pente-archive-actions';

        // REVIEW (Task 6.6): load the game read-only to browse via the history slider. Always
        // offered (`item.canReview` is always true). Keyed by the RECORD id — a conflicted record is
        // reachable only by its own key. We close FIRST so the blocking archive scope is popped
        // before the async load resolves — the review happens against the game/camera scopes, not
        // under a stale modal scope.
        if (item.canReview) {
          const reviewButton = doc.createElement('button');
          reviewButton.className = 'pente-archive-review';
          reviewButton.setAttribute('data-testid', `archive-review-${item.id}`);
          reviewButton.textContent = 'Review';
          reviewButton.addEventListener('click', () => {
            close();
            void deps.reviewArchived(item.id);
          });
          actions.appendChild(reviewButton);
        }

        // RESUME (Task 6.6): load the game and CONTINUE PLAYING. Offered only for a resumable
        // (unfinished) game — a finished or conflicted row has no Resume button, so the DOM itself
        // proves review-vs-resume from the pure `canResume` flag (never a hardcoded per-result rule).
        // Keyed by the GAME UUID (Task V.6): the game is what is being continued, and its record key
        // is not always its identity (a pre-V.5 record, a conflicted record).
        //
        // UNLIKE REVIEW, THE MODAL CLOSES ONLY ON SUCCESS. `canResume` is derived from the stored
        // result alone, so a row can be offered and still be refused by the glue (the row went stale,
        // a live room is running the game, the record is damaged). Closing first — as review does,
        // and as this did — made every one of those refusals invisible: the list vanished and the
        // board never changed. So the outcome is awaited, and a refusal keeps the list open with the
        // model's reason on it, next to the row that was clicked.
        if (item.canResume) {
          const resumeButton = doc.createElement('button');
          resumeButton.className = 'pente-archive-resume';
          resumeButton.setAttribute('data-testid', `archive-resume-${item.id}`);
          resumeButton.textContent = 'Resume';
          resumeButton.addEventListener('click', () => {
            showRefusal(null);
            void deps.resumeArchived(item.uuid).then((outcome) => {
              if (outcome.ok) close();
              else showRefusal(RESUME_REFUSAL_TEXT[outcome.reason]);
            });
          });
          actions.appendChild(resumeButton);
        }

        row.appendChild(actions);
        return row;
      }

      /** Rebuild the game rows from the pure model derived off the archive listings. */
      async function renderRows(): Promise<void> {
        const listings = await deps.listArchive();
        const model = deriveArchive(listings);
        body.replaceChildren();
        empty.hidden = !model.isEmpty;
        element.setAttribute('data-empty', String(model.isEmpty));
        element.setAttribute('data-count', String(model.items.length));

        // One SECTION per status the model emitted (Task V.6, ticket #37): unfinished games lead,
        // and their section is rendered even when it holds nothing — the model decides which
        // sections exist and what an empty one says, so this loop makes no judgement of its own.
        for (const group of model.groups) {
          const section = doc.createElement('div');
          section.className = 'pente-archive-group';
          section.setAttribute('data-testid', `archive-group-${group.status}`);
          section.setAttribute('data-status', group.status);
          section.setAttribute('data-count', String(group.items.length));

          const heading = doc.createElement('div');
          heading.className = 'pente-archive-group-title';
          heading.textContent = group.label;
          section.appendChild(heading);

          if (group.isEmpty) {
            const note = doc.createElement('div');
            note.className = 'pente-archive-group-empty';
            note.setAttribute('data-testid', `archive-group-empty-${group.status}`);
            note.textContent = group.emptyText;
            section.appendChild(note);
          }

          for (const item of group.items) section.appendChild(buildRow(item));
          body.appendChild(section);
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
        // A fresh open starts with nothing to apologise for — the previous visit's refusal was about
        // a click that is over, and re-showing it would blame the list for something it did not do.
        showRefusal(null);
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
      showRefusal(null);

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
