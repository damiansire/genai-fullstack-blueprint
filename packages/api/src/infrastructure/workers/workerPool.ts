import { Worker, TransferListItem } from 'node:worker_threads';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';
import { AsyncResource } from 'node:async_hooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Task {
  id: number;
  payload: any;
  transferList?: TransferListItem[];
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  asyncResource: AsyncResource;
  timer?: ReturnType<typeof setTimeout>;
}

/** Default per-task timeout (ms). A hung worker must not leak a pending Promise. */
const DEFAULT_TASK_TIMEOUT_MS = 30_000;

export class WorkerPool {
  private workers: Worker[] = [];
  private idleWorkers: Worker[] = [];
  private taskQueue: Task[] = [];
  private taskIdCounter = 0;
  private taskMap = new Map<number, Task>();
  /** Which task id each worker is currently running, so a crash can settle it. */
  private workerTasks = new Map<Worker, number>();
  /** Once shutting down, a terminated worker must NOT be auto-replaced. */
  private isShuttingDown = false;

  constructor(
    private poolSize: number,
    private workerPath: string,
    private taskTimeoutMs: number = DEFAULT_TASK_TIMEOUT_MS,
  ) {
    this.initializePool();
  }

  private spawnWorker(): Worker {
    const ext = __filename.endsWith('.ts') ? '.ts' : '.js';
    const fullPath = join(__dirname, `${this.workerPath}${ext}`);
    const worker = new Worker(fullPath, {
      execArgv: __filename.endsWith('.ts') ? ['--experimental-strip-types'] : [],
    });

    worker.on('message', (msg) => this.handleMessage(worker, msg));
    worker.on('error', (err) => {
      console.error(`Worker error: ${err.message}`);
      // Reject the in-flight task; the 'exit' handler replaces the worker.
      this.failWorkerTask(worker, err instanceof Error ? err : new Error(String(err)));
    });
    worker.on('exit', (code) => {
      if (code !== 0) console.error(`Worker stopped with exit code ${code}`);
      // Settle any task still attributed to this worker before replacing it.
      this.failWorkerTask(worker, new Error(`Worker exited with code ${code}`));
      // During shutdown the exit is intentional (we called terminate()); replacing
      // the worker here would respawn it forever and the pool would never stop.
      if (!this.isShuttingDown) this.replaceWorker(worker);
    });

    return worker;
  }

  private initializePool() {
    for (let i = 0; i < this.poolSize; i++) {
      const worker = this.spawnWorker();
      this.workers.push(worker);
      this.idleWorkers.push(worker);
    }
  }

  /** Reject the task (if any) currently assigned to a worker that died/errored. */
  private failWorkerTask(worker: Worker, reason: Error) {
    const taskId = this.workerTasks.get(worker);
    if (taskId === undefined) return;
    this.workerTasks.delete(worker);
    const task = this.taskMap.get(taskId);
    if (!task) return;
    this.taskMap.delete(taskId);
    if (task.timer) clearTimeout(task.timer);
    task.asyncResource.runInAsyncScope(() => task.reject(reason));
  }

  private replaceWorker(deadWorker: Worker) {
    this.workers = this.workers.filter((w) => w !== deadWorker);
    this.idleWorkers = this.idleWorkers.filter((w) => w !== deadWorker);
    this.workerTasks.delete(deadWorker);
    // spawnWorker re-registers message/error/exit so a second crash is handled too.
    const worker = this.spawnWorker();
    this.workers.push(worker);
    this.idleWorkers.push(worker);
    this.processQueue();
  }

  private handleMessage(worker: Worker, msg: any) {
    const task = this.taskMap.get(msg.id);
    if (!task) {
      // The task is gone: it already timed out (which called worker.terminate())
      // and this is a late/straggler message from a worker on its way out. Do
      // NOT reinsert it into idleWorkers — otherwise processQueue could dispatch a
      // queued task to a terminating/dead worker. The 'exit' -> replaceWorker path
      // brings a fresh worker back into the pool.
      return;
    }
    this.taskMap.delete(msg.id);
    this.workerTasks.delete(worker);
    if (task.timer) clearTimeout(task.timer);
    task.asyncResource.runInAsyncScope(() => {
      if (msg.success) {
        // Workers reply with either `data` (jsonWorker) or `result`
        // (cpu/tool workers). Use ?? so falsy-but-valid payloads
        // (0, '', false, null) are not silently dropped.
        task.resolve(msg.data ?? msg.result);
      } else {
        task.reject(new Error(msg.error));
      }
    });
    this.idleWorkers.push(worker);
    this.processQueue();
  }

  private processQueue() {
    if (this.idleWorkers.length > 0 && this.taskQueue.length > 0) {
      const worker = this.idleWorkers.shift()!;
      const task = this.taskQueue.shift()!;
      this.taskMap.set(task.id, task);
      this.workerTasks.set(worker, task.id);
      // Per-task timeout: a hung worker rejects the Promise instead of leaking it.
      if (this.taskTimeoutMs > 0) {
        task.timer = setTimeout(() => {
          if (!this.taskMap.has(task.id)) return;
          this.taskMap.delete(task.id);
          this.workerTasks.delete(worker);
          task.asyncResource.runInAsyncScope(() =>
            task.reject(
              new Error(`Worker task ${task.id} timed out after ${this.taskTimeoutMs}ms`),
            ),
          );
          // The worker may be wedged; recycle it.
          worker.terminate();
        }, this.taskTimeoutMs);
      }
      worker.postMessage({ id: task.id, ...task.payload }, task.transferList);
    }
  }

  public runTask(payload: any, transferList?: TransferListItem[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.taskIdCounter;
      // AsyncResource re-binds the caller-side async context (traceId) for the
      // resolution callback. It does NOT propagate ALS into the worker isolate.
      const asyncResource = new AsyncResource('WorkerPoolTask');
      const task: Task = { id, payload, resolve, reject, asyncResource };
      if (transferList !== undefined) task.transferList = transferList;
      this.taskQueue.push(task);
      this.processQueue();
    });
  }

  /**
   * Terminate every worker in the pool so the process can exit cleanly. Pending
   * task timers are cleared and queued tasks are rejected; idempotent.
   */
  public async shutdown(): Promise<void> {
    // Flip the flag FIRST so the workers' `exit` handlers don't respawn the very
    // workers we're about to terminate (which would leave the pool alive forever).
    this.isShuttingDown = true;
    // Reject every task (in-flight + queued) so no caller is left hanging once
    // the workers are terminated.
    const pending = [...this.taskMap.values(), ...this.taskQueue];
    this.taskMap.clear();
    this.taskQueue.length = 0;
    for (const task of pending) {
      if (task.timer) clearTimeout(task.timer);
      task.asyncResource.runInAsyncScope(() =>
        task.reject(new Error('WorkerPool is shutting down')),
      );
    }
    const workers = this.workers.splice(0);
    this.idleWorkers = [];
    this.workerTasks.clear();
    await Promise.all(workers.map((w) => w.terminate()));
  }
}

const numCpus = os.cpus().length || 4;

// Pools are created lazily on first use, so importing this module does not eagerly
// spawn 3 x numCpus threads in processes that never run a worker task.
let cpuPoolInstance: WorkerPool | undefined;
let toolPoolInstance: WorkerPool | undefined;
let jsonPoolInstance: WorkerPool | undefined;
let safetyPoolInstance: WorkerPool | undefined;

function getCpuPool(): WorkerPool {
  return (cpuPoolInstance ??= new WorkerPool(numCpus, 'cpuWorker'));
}
function getToolPool(): WorkerPool {
  return (toolPoolInstance ??= new WorkerPool(numCpus, 'toolWorker'));
}
function getJsonPool(): WorkerPool {
  return (jsonPoolInstance ??= new WorkerPool(numCpus, 'jsonWorker'));
}
function getSafetyPool(): WorkerPool {
  // Classification can be CPU-heavy (and would be heavier with a real SLM), so a
  // shorter timeout keeps a wedged classification from stalling a request.
  return (safetyPoolInstance ??= new WorkerPool(numCpus, 'safetyWorker', 10_000));
}

/**
 * Terminate every worker in every pool that was actually created. Wire this into
 * the server's graceful-shutdown sequence so SIGINT/SIGTERM exits cleanly.
 */
export async function shutdownWorkerPools(): Promise<void> {
  const pools = [cpuPoolInstance, toolPoolInstance, jsonPoolInstance, safetyPoolInstance].filter(
    (p): p is WorkerPool => p !== undefined,
  );
  cpuPoolInstance = toolPoolInstance = jsonPoolInstance = safetyPoolInstance = undefined;
  await Promise.all(pools.map((p) => p.shutdown()));
}

export class CPUWorkerService {
  public static runCpuIntensiveTask(payload: any, iterations?: number): Promise<any> {
    return getCpuPool().runTask({ payload, iterations });
  }

  public static executeTool(toolName: string, args: any, agentContext?: object): Promise<any> {
    return getToolPool().runTask({ toolName, args, agentContext });
  }

  public static parseJsonZeroCopy(buffer: ArrayBuffer, schemaName: string = 'Any'): Promise<any> {
    return getJsonPool().runTask({ buffer, schemaName }, [buffer]);
  }

  /**
   * Run safety/DLP classification off the main thread. The worker returns a
   * SafetyVerdict ({ flagged, score, category, reason }). This is the SLM-ready
   * seam: the heavy scan never blocks the Event Loop.
   */
  public static classifySafety(text: string): Promise<any> {
    return getSafetyPool().runTask({ text });
  }
}
