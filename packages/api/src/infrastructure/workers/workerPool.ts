import { Worker } from 'node:worker_threads';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class CPUWorkerService {
  /**
   * Executes a CPU-intensive task in a separate thread.
   * Promisifies the native worker_threads API.
   */
  public static runCpuIntensiveTask(payload: any, iterations?: number): Promise<any> {
    return new Promise((resolve, reject) => {
      // In a real TS environment we point to the compiled .js or use tsx 
      // For simplicity in this scaffold, we point to cpuWorker.ts and let tsx/loader handle it.
      const workerPath = join(__dirname, 'cpuWorker.js'); 
      
      const worker = new Worker(workerPath, {
        workerData: { payload, iterations }
      });

      worker.on('message', resolve);
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  }
}
