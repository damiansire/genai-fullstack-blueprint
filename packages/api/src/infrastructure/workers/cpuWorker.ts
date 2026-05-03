import { isMainThread, parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

if (!isMainThread && parentPort) {
  parentPort.on('message', (message) => {
    const { id, payload, iterations = 1e7 } = message;
    const start = performance.now();
    
    // Simulate a CPU intensive task (e.g., tokenizing a huge text or heavy JSON processing)
    let sum = 0;
    for (let i = 0; i < iterations; i++) {
      sum += Math.sqrt(i) * Math.sin(i);
    }
    
    const end = performance.now();
    
    parentPort!.postMessage({
      id,
      success: true,
      result: sum,
      processingTimeMs: Math.round(end - start),
      payloadLength: payload ? JSON.stringify(payload).length : 0
    });
  });
}
