---
name: streaming-render
description: Smoothly render LLM token streams in the UI using a requestAnimationFrame char-drain loop with adaptive speed and clean cancellation. Read before touching SSE / streaming services.
user-invocable: true
---

# Streaming render

LLM SSE chunks arrive in irregular bursts (50 chars at once, then nothing for
300ms). Painting deltas as they arrive makes text "jump" and tear, and forces a
re-render per token.

## DO

- Enqueue incoming characters into an output queue; **drain the queue on
  `requestAnimationFrame`**, emitting at most one UI update per frame (≤60fps).
- Make the drain speed **adaptive to backpressure**: target speed grows when the
  queue is long (`targetSpeed = max(baseSpeed, queue.length)`) so the text never
  lags far behind the model, and eases back down as it empties.
- Use a **time accumulator** (`accumulatedTime += frameDuration`), not
  `setInterval` — robust against dropped frames and backgrounded tabs.
- **Flush the whole queue** on finish and on abort, then `cancelAnimationFrame`.
  Without an explicit flush, aborting leaves characters stranded.

## DON'T

- Don't call `signal.set/update` (or `setState`) once per raw SSE chunk.
- Don't drive the typewriter with `setInterval`.
- Don't forget cleanup: every started rAF loop must be cancellable.

## Where

The reusable mechanism is `packages/client/src/core/streaming/smooth-stream.ts`
(`createSmoothMessage`). The Angular `AiStreamService` should feed its raw deltas
through it instead of appending directly to the `streamText` signal.
