import { isMainThread, parentPort } from 'node:worker_threads';
import { z } from 'zod';
import { performance } from 'node:perf_hooks';

// This worker receives an ArrayBuffer (zero-copy transfer),
// decodes it to a string, parses the JSON, and validates it with Zod.

if (!isMainThread && parentPort) {
  parentPort.on('message', (message) => {
    const { id, buffer, schemaName } = message;
    try {
      const start = performance.now();

      // Zero-copy decoding
      const textDecoder = new TextDecoder('utf-8');
      const jsonString = textDecoder.decode(buffer as ArrayBuffer);

      // Parse JSON
      const parsedData = JSON.parse(jsonString);

      // Validate with Zod
      let validatedData = parsedData;
      if (schemaName === 'ArraySchema') {
        const schema = z.array(z.any());
        validatedData = schema.parse(parsedData);
      } else if (schemaName === 'ObjectSchema') {
        const schema = z.object({}).passthrough();
        validatedData = schema.parse(parsedData);
      } else {
        const schema = z.any();
        validatedData = schema.parse(parsedData);
      }

      const end = performance.now();

      parentPort!.postMessage({
        id,
        success: true,
        data: validatedData,
        processingTimeMs: Math.round(end - start),
      });
    } catch (error) {
      parentPort!.postMessage({
        id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
