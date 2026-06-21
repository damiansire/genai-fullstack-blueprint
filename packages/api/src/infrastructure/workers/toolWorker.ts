import { parentPort } from 'node:worker_threads';
import { z } from 'zod';

if (!parentPort) {
  throw new Error('This file must be run as a worker thread');
}

/**
 * Bound the fibonacci input so a large `n` cannot burn a core. The result is
 * computed iteratively (O(n), no exponential recursion), and `n` is clamped to a
 * range that stays within Number.MAX_SAFE_INTEGER for the iterative series.
 */
const fibonacciArgs = z.object({
  n: z.coerce.number().int().min(0).max(78).default(30),
});

function fibonacci(n: number): number {
  let a = 0;
  let b = 1;
  for (let i = 0; i < n; i++) {
    [a, b] = [b, a + b];
  }
  return a;
}

parentPort.on('message', async (message) => {
  // `agentContext` carries the serialized child span context (traceId/spanId/…)
  // for OTLP span-tree reconstruction; it is forwarded by the caller via the
  // task payload. We surface it on the reply so the parent can stitch the span.
  const { id, toolName, args, agentContext } = message;

  try {
    let result;

    switch (toolName) {
      case 'calculate_fibonacci': {
        const parsed = fibonacciArgs.safeParse(args ?? {});
        if (!parsed.success) {
          parentPort!.postMessage({
            id,
            success: false,
            error: `Invalid args for calculate_fibonacci: ${parsed.error.message}`,
            agentContext,
          });
          return;
        }
        result = fibonacci(parsed.data.n);
        break;
      }
      case 'render_chart':
        result = { type: 'bar', data: [10, 20, 30], label: args?.label || 'Sales' };
        break;
      default:
        result = { error: `Tool ${toolName} not recognized` };
    }

    parentPort!.postMessage({ id, success: true, result, agentContext });
  } catch (error) {
    parentPort!.postMessage({ id, success: false, error: String(error), agentContext });
  }
});
