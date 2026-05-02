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
      const ext = __filename.endsWith('.ts') ? '.ts' : '.js';
      const workerPath = join(__dirname, `cpuWorker${ext}`); 
      
      const worker = new Worker(workerPath, {
        workerData: { payload, iterations },
        execArgv: __filename.endsWith('.ts') ? ['--experimental-strip-types'] : []
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

  public static executeTool(toolName: string, args: any, agentContext?: object): Promise<any> {
    return new Promise((resolve, reject) => {
      const workerPath = join(__dirname, 'toolWorker.js');
      const worker = new Worker(workerPath, {
        // Patrón 5: pass the serialized child context so the Worker can
        // restore its position in the agentic span tree via createChildContext().
        workerData: { toolName, args, agentContext },
        execArgv: __filename.endsWith('.ts') ? ['--experimental-strip-types'] : []
      });
      worker.on('message', resolve);
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`Tool worker stopped with exit code ${code}`));
      });
    });
  }


  /**
   * Executes zero-copy JSON parsing and Zod validation using a worker thread.
   * Passes the ArrayBuffer ownership to the worker thread via transferList.
   */
  public static parseJsonZeroCopy(buffer: ArrayBuffer, schemaName: string = 'Any'): Promise<any> {
    return new Promise((resolve, reject) => {
      const ext = __filename.endsWith('.ts') ? '.ts' : '.js';
      const workerPath = join(__dirname, `jsonWorker${ext}`);
      
      const worker = new Worker(workerPath, {
        workerData: { schemaName },
        execArgv: __filename.endsWith('.ts') ? ['--experimental-strip-types'] : []
      });

      worker.on('message', (msg) => {
        if (msg.success) resolve(msg.data);
        else reject(new Error(msg.error));
        worker.terminate();
      });
      
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`JSON worker stopped with exit code ${code}`));
      });

      // Transfer ownership of the ArrayBuffer to the worker
      worker.postMessage({ buffer }, [buffer]);
    });
  }
}
