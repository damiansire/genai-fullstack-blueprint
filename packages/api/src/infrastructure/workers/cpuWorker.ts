import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

// This file acts as both the main thread invoker (if imported) and the worker thread execution context.
// In a real GenAI scenario, this could be used for parsing giant JSON payloads, running local tokenizer counts, 
// or executing synchronous cryptographic algorithms without blocking the Event Loop.

if (!isMainThread && parentPort) {
  // --- WORKER THREAD CONTEXT ---
  
  const { payload, iterations = 1e7 } = workerData;
  const start = performance.now();
  
  // Simulate a CPU intensive task (e.g., tokenizing a huge text or heavy JSON processing)
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    sum += Math.sqrt(i) * Math.sin(i);
  }
  
  const end = performance.now();
  
  // Send the result back to the main thread
  parentPort.postMessage({
    success: true,
    result: sum,
    processingTimeMs: Math.round(end - start),
    payloadLength: payload ? JSON.stringify(payload).length : 0
  });
}
