// Stability: 1 - Experimental (node:test)
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker } from './circuit-breaker.js';

const ok = () => Promise.resolve('ok');
const fail = () => Promise.reject(new Error('boom'));

describe('CircuitBreaker', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['Date'] });
  });

  afterEach(() => {
    mock.timers.reset();
  });

  it('starts CLOSED and passes successful calls through', async () => {
    const cb = new CircuitBreaker('t', { failureThreshold: 3, resetTimeoutMs: 1000 });
    assert.equal(cb.getState(), 'CLOSED');
    assert.equal(await cb.fire(ok), 'ok');
    assert.equal(cb.getState(), 'CLOSED');
  });

  it('opens after reaching the failure threshold', async () => {
    const cb = new CircuitBreaker('t', { failureThreshold: 2, resetTimeoutMs: 1000 });

    await assert.rejects(cb.fire(fail), /boom/);
    assert.equal(cb.getState(), 'CLOSED'); // 1 failure < threshold

    await assert.rejects(cb.fire(fail), /boom/);
    assert.equal(cb.getState(), 'OPEN'); // 2 failures == threshold
  });

  it('fast-fails while OPEN without invoking the action', async () => {
    const cb = new CircuitBreaker('t', { failureThreshold: 1, resetTimeoutMs: 5000 });
    await assert.rejects(cb.fire(fail), /boom/);
    assert.equal(cb.getState(), 'OPEN');

    const action = mock.fn(ok);
    await assert.rejects(cb.fire(action), /is OPEN/);
    assert.equal(action.mock.callCount(), 0, 'action must not run while OPEN');
  });

  it('moves OPEN -> HALF_OPEN after the reset timeout and CLOSES on success', async () => {
    const cb = new CircuitBreaker('t', { failureThreshold: 1, resetTimeoutMs: 1000 });
    await assert.rejects(cb.fire(fail), /boom/);
    assert.equal(cb.getState(), 'OPEN');

    // Advance the clock past resetTimeoutMs so the next call probes (HALF_OPEN).
    mock.timers.tick(1001);

    const states: string[] = [];
    cb.on('stateChange', (e: { newState: string }) => states.push(e.newState));

    assert.equal(await cb.fire(ok), 'ok');
    assert.equal(cb.getState(), 'CLOSED');
    assert.deepEqual(states, ['HALF_OPEN', 'CLOSED']);
  });

  it('re-OPENS if the HALF_OPEN probe fails', async () => {
    const cb = new CircuitBreaker('t', { failureThreshold: 1, resetTimeoutMs: 1000 });
    await assert.rejects(cb.fire(fail), /boom/);
    assert.equal(cb.getState(), 'OPEN');

    mock.timers.tick(1001);
    await assert.rejects(cb.fire(fail), /boom/);
    // A failure in HALF_OPEN transitions straight back to OPEN.
    assert.equal(cb.getState(), 'OPEN');
  });

  it('admits only a single probe in HALF_OPEN while one is in flight', async () => {
    const cb = new CircuitBreaker('t', { failureThreshold: 1, resetTimeoutMs: 1000 });
    await assert.rejects(cb.fire(fail), /boom/);
    assert.equal(cb.getState(), 'OPEN');

    mock.timers.tick(1001);

    // First caller becomes the probe; it hangs so the probe stays in flight.
    let releaseProbe!: (v: string) => void;
    const hung = () => new Promise<string>((resolve) => { releaseProbe = resolve; });
    const probe = cb.fire(hung);
    assert.equal(cb.getState(), 'HALF_OPEN');

    // Concurrent callers must fast-fail instead of all hitting the backend.
    const action = mock.fn(ok);
    await assert.rejects(cb.fire(action), /HALF_OPEN/);
    assert.equal(action.mock.callCount(), 0, 'no extra probe must run while one is in flight');

    // Let the probe succeed -> circuit closes and the flag is released.
    releaseProbe('ok');
    assert.equal(await probe, 'ok');
    assert.equal(cb.getState(), 'CLOSED');
  });

  it('resets the failure count on a successful call', async () => {
    const cb = new CircuitBreaker('t', { failureThreshold: 2, resetTimeoutMs: 1000 });
    await assert.rejects(cb.fire(fail), /boom/);
    assert.equal(await cb.fire(ok), 'ok'); // success clears the count
    await assert.rejects(cb.fire(fail), /boom/);
    // Only 1 consecutive failure after the reset, so still CLOSED.
    assert.equal(cb.getState(), 'CLOSED');
  });
});
