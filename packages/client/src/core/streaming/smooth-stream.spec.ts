import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSmoothMessage } from './smooth-stream';

/**
 * Deterministic requestAnimationFrame harness: each scheduled callback is held
 * until `tick()` is called, advancing the timestamp by a fixed frame duration.
 */
function installRafHarness() {
  let pending: ((ts: number) => void) | null = null;
  let now = 0;
  const FRAME = 16;

  const raf = vi.fn((cb: (ts: number) => void): number => {
    pending = cb;
    return 1;
  });
  const cancel = vi.fn((): void => {
    pending = null;
  });

  (globalThis as Record<string, unknown>)['requestAnimationFrame'] = raf;
  (globalThis as Record<string, unknown>)['cancelAnimationFrame'] = cancel;

  return {
    raf,
    cancel,
    /** Advance enough frames (with a large dt) to drain everything queued. */
    drain(maxFrames = 5000): void {
      let frames = 0;
      while (pending && frames < maxFrames) {
        const cb = pending;
        pending = null;
        now += FRAME * 50; // large dt so adaptive speed clears the queue fast
        cb(now);
        frames += 1;
      }
    },
    hasPending(): boolean {
      return pending !== null;
    },
  };
}

describe('createSmoothMessage', () => {
  let harness: ReturnType<typeof installRafHarness>;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    harness = installRafHarness();
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
    vi.restoreAllMocks();
  });

  it('accumulates pushed deltas into the full buffer', () => {
    let last = '';
    const ctrl = createSmoothMessage({
      onTextUpdate: (_delta, buffer) => {
        last = buffer;
      },
    });

    ctrl.pushText('Hello');
    ctrl.pushText(' World');
    harness.drain();

    expect(last).toBe('Hello World');
    expect(ctrl.isAnimationActive()).toBe(false);
  });

  it('emits the concatenation of all deltas exactly once total', () => {
    const deltas: string[] = [];
    const ctrl = createSmoothMessage({
      onTextUpdate: (delta) => {
        deltas.push(delta);
      },
    });

    ctrl.pushText('abc');
    harness.drain();

    expect(deltas.join('')).toBe('abc');
  });

  it('flushQueue drains everything immediately and stops the loop', () => {
    let last = '';
    const ctrl = createSmoothMessage({
      onTextUpdate: (_delta, buffer) => {
        last = buffer;
      },
    });

    ctrl.pushText('Hello World');
    // Do NOT drain via frames; flush synchronously instead.
    ctrl.flushQueue();

    expect(last).toBe('Hello World');
    expect(ctrl.isAnimationActive()).toBe(false);
    expect(harness.cancel).toHaveBeenCalled();
  });

  it('stopAnimation cancels the frame and leaves the queue undrained', () => {
    const updates: string[] = [];
    const ctrl = createSmoothMessage({
      onTextUpdate: (delta) => {
        updates.push(delta);
      },
    });

    ctrl.pushText('Hello World');
    ctrl.stopAnimation();

    expect(ctrl.isAnimationActive()).toBe(false);
    expect(harness.cancel).toHaveBeenCalled();
    // Nothing was drained because the loop never ran a frame.
    expect(updates.join('')).toBe('');
  });

  it('ignores empty pushes without scheduling a frame', () => {
    const ctrl = createSmoothMessage({ onTextUpdate: () => {} });

    ctrl.pushText('');

    expect(ctrl.isAnimationActive()).toBe(false);
    expect(harness.raf).not.toHaveBeenCalled();
  });
});
