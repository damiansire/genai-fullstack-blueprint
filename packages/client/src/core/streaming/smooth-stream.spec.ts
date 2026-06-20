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
    /**
     * Advance up to `maxFrames` frames with a realistic per-frame dt, returning
     * how many frames were actually run. Unlike `drain`, the small dt exercises
     * the sub-character time accumulation path.
     */
    step(frameDt = FRAME, maxFrames = 5000): number {
      let frames = 0;
      while (pending && frames < maxFrames) {
        const cb = pending;
        pending = null;
        now += frameDt;
        cb(now);
        frames += 1;
      }
      return frames;
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

  it('preserves the sub-character time remainder across small frames (no rate bias)', () => {
    // With a fixed low speed and realistic ~16ms frames, each frame contributes
    // a fraction of a character. The old code reset accumulatedTime to 0 after
    // every emit, discarding that fractional credit and dragging the effective
    // drain rate below startSpeed. Subtracting only the consumed cost keeps the
    // remainder so the queue still drains at (approximately) startSpeed.
    let last = '';
    const speed = 10; // chars/second
    const ctrl = createSmoothMessage({
      startSpeed: speed,
      onTextUpdate: (_delta, buffer) => {
        last = buffer;
      },
    });

    const text = 'ABCDEFGH'; // 8 chars, < speed so adaptive speed stays ~speed
    ctrl.pushText(text);

    const frameDt = 16;
    const framesUsed = harness.step(frameDt);

    // Everything drains.
    expect(last).toBe(text);

    // Lower bound on elapsed time if no fractional credit were ever discarded:
    // 8 chars at 10 char/s = 800ms. With the reset bug, up to ~one frame of
    // credit was thrown away per emitted char, inflating the required time well
    // beyond this. Allow a small slack for the final partial frame.
    const elapsedMs = framesUsed * frameDt;
    const idealMs = (text.length * 1000) / speed;
    expect(elapsedMs).toBeLessThanOrEqual(idealMs + frameDt);
  });

  it('ignores empty pushes without scheduling a frame', () => {
    const ctrl = createSmoothMessage({ onTextUpdate: () => {} });

    ctrl.pushText('');

    expect(ctrl.isAnimationActive()).toBe(false);
    expect(harness.raf).not.toHaveBeenCalled();
  });
});
