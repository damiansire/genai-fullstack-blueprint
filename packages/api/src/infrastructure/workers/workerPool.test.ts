// Stability: 1 - Experimental (node:test)
//
// Behavior tests for the generic WorkerPool. They use a dedicated fixture
// worker (testFixtureWorker) that reacts to a `cmd` field, so success,
// failure, per-task timeout, and crash-recovery can all be driven
// deterministically without depending on the real CPU/tool/json workers.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerPool } from './workerPool.ts';

// Single shared pool for the happy-path/concurrency tests. A small generous
// timeout keeps normal tasks well clear of the timeout path.
const pool = new WorkerPool(2, 'testFixtureWorker', 5_000);

describe('WorkerPool', () => {
  // Terminate the shared pool's worker threads so this file exits on its own
  // (the suite no longer depends on --test-force-exit to reap leaked workers).
  after(async () => {
    await pool.shutdown();
  });

  it('runs a task and resolves with the worker result', async () => {
    const out = await pool.runTask({ cmd: 'echo', value: 123 });
    assert.equal(out, 123);
  });

  it('rejects when the worker reports failure (success:false)', async () => {
    await assert.rejects(pool.runTask({ cmd: 'fail', reason: 'nope' }), /nope/);
  });

  it('handles more concurrent tasks than workers via the queue', async () => {
    // 6 tasks, pool size 2 -> the queue must drain them all correctly.
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => pool.runTask({ cmd: 'echo', value: i })),
    );
    assert.deepEqual(results, [0, 1, 2, 3, 4, 5]);
  });

  it('rejects a hung task once the per-task timeout elapses', async (t) => {
    // Dedicated pool with a tiny timeout so the hang is settled quickly. No task
    // runs after the timeout: the replacement worker boots from scratch and, on a
    // loaded machine, takes longer than 150ms, so a follow-up task here would time
    // out too. Recovery after a dead worker is covered by the crash test below,
    // whose timeout leaves room for the boot.
    const hangPool = new WorkerPool(1, 'testFixtureWorker', 150);
    // Shut down even if an assertion fails, or the live thread keeps the file running.
    t.after(() => hangPool.shutdown());
    await assert.rejects(hangPool.runTask({ cmd: 'hang' }), /timed out after 150ms/);
  });

  it('settles the in-flight task and recovers when a worker crashes', async (t) => {
    const crashPool = new WorkerPool(1, 'testFixtureWorker', 5_000);
    t.after(() => crashPool.shutdown());
    // The crash rejects the in-flight task...
    await assert.rejects(crashPool.runTask({ cmd: 'crash' }), /crashed|exited with code/);
    // ...and the pool replaces the dead worker, so the next task still works.
    const out = await crashPool.runTask({ cmd: 'echo', value: 'recovered' });
    assert.equal(out, 'recovered');
  });

  it('shutdown() terminates workers and rejects queued tasks', async () => {
    const dummy = new WorkerPool(1, 'testFixtureWorker', 5_000);
    // Occupy the single worker, then queue a second task behind it.
    const inFlight = dummy.runTask({ cmd: 'echo', value: 'first' }).catch(() => undefined);
    const queued = dummy.runTask({ cmd: 'echo', value: 'second' });
    // Attach the rejection expectation BEFORE shutdown so the queued task's
    // rejection is never momentarily unhandled.
    const queuedRejects = assert.rejects(queued, /shutting down/);
    await dummy.shutdown();
    // The queued task must be rejected by the shutdown, not left pending forever;
    // the in-flight task settles without hanging the process.
    await queuedRejects;
    await inFlight;
  });
});
// Note: every pool this file creates is shut down (the shared `pool` in `after`,
// `hangPool`/`crashPool` in `t.after` so it happens even when the test fails,
// `dummy` inside its own test), so no worker thread outlives the suite and the
// test process exits on its own — no --test-force-exit needed.
