/**
 * # `npm run scenario:all` — the whole cross-component matrix, one run
 *
 * Task **V.7** (epic #47). The CLI scenarios are the GLUE tier of the v3.1 test strategy (design §8):
 * real daemons, real relay, assertions on each daemon's own state. They exist because component
 * gates have passed while the wiring between components was silently missing — #35 scored 98% on
 * mutation with the durable seat map not connected to anything — so they only do their job if they
 * are all run, together, routinely.
 *
 * ## What it runs
 *
 * Every `*.ts` in this directory that `harness.isScenario` accepts — i.e. all of them except this
 * runner, the shared {@link harness}, and the vitest suites that test the harness (`*.test.ts`).
 * Discovery is by DIRECTORY, not a list: a scenario that exists cannot be left out of the suite by
 * forgetting to add it here, which is the failure mode a hand-maintained registry has.
 *
 * That cuts both ways, which is why `report()` refuses to exit 0 on zero checks: a scenario that
 * stops asserting is still discovered, and without that refusal it would join the matrix as a green
 * line saying nothing.
 *
 * ## Exit codes — a missing relay is not a regression
 *
 * Each scenario already distinguishes the two (`harness.requireRelay`): `0` all checks passed, `1`
 * a check FAILED, `2` SKIPPED because the relay is unreachable. This runner preserves that:
 *
 * - **1** — at least one scenario FAILED. The only outcome that means something is broken.
 * - **2** — every scenario was skipped (no egress to the relay): nothing was proven, and the run says
 *   so instead of reporting a green suite that tested nothing.
 * - **0** — at least one scenario passed and none failed.
 *
 * Scenarios run SEQUENTIALLY: each spawns two daemons that hold a live MQTT connection and assert on
 * multi-second real-network settling, so overlapping runs would trade a clear failure for a flaky one.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_UNREACHABLE, REPO_ROOT, isScenario } from './harness';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

/**
 * How long one scenario may run before it is killed and counted as a FAILURE. A scenario that hangs
 * is a broken scenario — a daemon that never reached a seat, a `wait` nothing ever wakes — and the
 * suite must say so rather than block forever. Comfortably above the slowest real-relay run.
 */
const PER_SCENARIO_TIMEOUT_MS = 10 * 60_000;

type Outcome = 'passed' | 'FAILED' | 'skipped';

interface Result {
  readonly name: string;
  readonly outcome: Outcome;
  readonly exitCode: number | null;
  readonly ms: number;
}

function scenarioFiles(): string[] {
  return fs.readdirSync(HERE).filter(isScenario).sort();
}

/** Run one scenario as its own process, streaming its output through, and classify its exit code. */
function runScenario(file: string): Promise<Result> {
  const started = Date.now();
  return new Promise((resolve) => {
    console.log(`\n${'━'.repeat(70)}\n▶ ${file}\n${'━'.repeat(70)}`);
    const proc = spawn(TSX, [path.join(HERE, file)], { stdio: 'inherit' });
    const timer = setTimeout(() => proc.kill('SIGKILL'), PER_SCENARIO_TIMEOUT_MS);
    proc.on('close', (code) => {
      clearTimeout(timer);
      // A killed process reports `code: null` (+ a signal); it is a failure, not a skip.
      const outcome: Outcome = code === 0 ? 'passed' : code === EXIT_UNREACHABLE ? 'skipped' : 'FAILED';
      resolve({ name: file, outcome, exitCode: code, ms: Date.now() - started });
    });
  });
}

async function main(): Promise<number> {
  const files = scenarioFiles();
  console.log(`scenario:all — ${files.length} scenarios: ${files.join(', ')}`);
  const results: Result[] = [];
  for (const file of files) results.push(await runScenario(file));

  const failed = results.filter((r) => r.outcome === 'FAILED');
  const skipped = results.filter((r) => r.outcome === 'skipped');
  const passed = results.filter((r) => r.outcome === 'passed');

  console.log(`\n${'═'.repeat(70)}\nSCENARIO MATRIX\n${'═'.repeat(70)}`);
  for (const r of results) {
    const mark = r.outcome === 'passed' ? '✓' : r.outcome === 'skipped' ? '⤼' : '✗';
    console.log(
      `  ${mark} ${r.name.padEnd(34)} ${r.outcome.padEnd(8)} exit ${String(r.exitCode)} · ${(r.ms / 1000).toFixed(1)}s`,
    );
  }
  console.log(
    `${'─'.repeat(70)}\n  ${passed.length} passed · ${failed.length} FAILED · ${skipped.length} skipped (relay unreachable)`,
  );

  if (failed.length > 0) {
    console.log(`\n${failed.length} scenario(s) FAILED: ${failed.map((r) => r.name).join(', ')}`);
    console.log('═'.repeat(70));
    return 1;
  }
  if (skipped.length === results.length) {
    console.log(
      '\nEvery scenario was SKIPPED — the relay was unreachable, so this run proved NOTHING.\n' +
        `Exiting ${EXIT_UNREACHABLE} (skipped), not 0.`,
    );
    console.log('═'.repeat(70));
    return EXIT_UNREACHABLE;
  }
  console.log('\nall run scenarios passed.');
  console.log('═'.repeat(70));
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error('scenario:all error: ' + (e instanceof Error ? e.message : String(e)));
    process.exit(1);
  });
