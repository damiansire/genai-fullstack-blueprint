import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { z } from 'zod';
import { performance } from 'node:perf_hooks';

// This worker receives an ArrayBuffer (zero-copy transfer),
// decodes it to a string, parses the JSON, and validates it with Zod.

if (!isMainThread && parentPort) {
  // workerData contains { schemaName }
  const { schemaName } = workerData;

  parentPort.on('message', (message) => {
    try {
      const start = performance.now();
      const buffer = message.buffer as ArrayBuffer;
      
      // Zero-copy decoding
      const textDecoder = new TextDecoder('utf-8');
      const jsonString = textDecoder.decode(buffer);
      
      // Parse JSON
      const parsedData = JSON.parse(jsonString);

      // In a real application, you'd map schemaName to actual imported Zod schemas.
      // Here we simulate validation. If schemaName is provided, we validate it.
      let validatedData = parsedData;
      
      if (schemaName === 'ArraySchema') {
        const schema = z.array(z.any());
        validatedData = schema.parse(parsedData);
      } else if (schemaName === 'ObjectSchema') {
        const schema = z.object({}).passthrough();
        validatedData = schema.parse(parsedData);
      } else {
        // generic fallback
        const schema = z.any();
        validatedData = schema.parse(parsedData);
      }

      const end = performance.now();

      parentPort!.postMessage({
        success: true,
        data: validatedData,
        processingTimeMs: Math.round(end - start)
      });
    } catch (error) {
      parentPort!.postMessage({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}
