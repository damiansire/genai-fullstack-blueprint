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
}

export class WorkerPool {
  private workers: Worker[] = [];
  private idleWorkers: Worker[] = [];
  private taskQueue: Task[] = [];
  private taskIdCounter = 0;
  private taskMap = new Map<number, Task>();

  constructor(private poolSize: number, private workerPath: string) {
    this.initializePool();
  }

  private initializePool() {
    for (let i = 0; i < this.poolSize; i++) {
      const ext = __filename.endsWith('.ts') ? '.ts' : '.js';
      const fullPath = join(__dirname, `${this.workerPath}${ext}`);
      const worker = new Worker(fullPath, {
        execArgv: __filename.endsWith('.ts') ? ['--experimental-strip-types'] : []
      });
      
      worker.on('message', (msg) => this.handleMessage(worker, msg));
      worker.on('error', (err) => console.error(`Worker error: ${err.message}`));
      worker.on('exit', (code) => {
        if (code !== 0) console.error(`Worker stopped with exit code ${code}`);
        this.replaceWorker(worker);
      });
      
      this.workers.push(worker);
      this.idleWorkers.push(worker);
    }
  }

  private replaceWorker(deadWorker: Worker) {
     this.workers = this.workers.filter(w => w !== deadWorker);
     this.idleWorkers = this.idleWorkers.filter(w => w !== deadWorker);
     const ext = __filename.endsWith('.ts') ? '.ts' : '.js';
     const fullPath = join(__dirname, `${this.workerPath}${ext}`);
     const worker = new Worker(fullPath, {
        execArgv: __filename.endsWith('.ts') ? ['--experimental-strip-types'] : []
     });
     worker.on('message', (msg) => this.handleMessage(worker, msg));
     worker.on('error', (err) => console.error(`Worker error: ${err.message}`));
     this.workers.push(worker);
     this.idleWorkers.push(worker);
     this.processQueue();
  }

  private handleMessage(worker: Worker, msg: any) {
    const task = this.taskMap.get(msg.id);
    if (task) {
      this.taskMap.delete(msg.id);
      task.asyncResource.runInAsyncScope(() => {
        if (msg.success) {
          task.resolve(msg.data || msg.result);
        } else {
          task.reject(new Error(msg.error));
        }
      });
    }
    this.idleWorkers.push(worker);
    this.processQueue();
  }

  private processQueue() {
    if (this.idleWorkers.length > 0 && this.taskQueue.length > 0) {
      const worker = this.idleWorkers.shift()!;
      const task = this.taskQueue.shift()!;
      this.taskMap.set(task.id, task);
      worker.postMessage({ id: task.id, ...task.payload }, task.transferList);
    }
  }

  public runTask(payload: any, transferList?: TransferListItem[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.taskIdCounter;
      // Using AsyncResource to maintain async context traceId across worker boundary
      const asyncResource = new AsyncResource('WorkerPoolTask');
      this.taskQueue.push({ id, payload, transferList, resolve, reject, asyncResource });
      this.processQueue();
    });
  }
}

const numCpus = os.cpus().length || 4;
export const cpuPool = new WorkerPool(numCpus, 'cpuWorker');
export const toolPool = new WorkerPool(numCpus, 'toolWorker');
export const jsonPool = new WorkerPool(numCpus, 'jsonWorker');

export class CPUWorkerService {
  public static runCpuIntensiveTask(payload: any, iterations?: number): Promise<any> {
     return cpuPool.runTask({ payload, iterations });
  }

  public static executeTool(toolName: string, args: any, agentContext?: object): Promise<any> {
     return toolPool.runTask({ toolName, args, agentContext });
  }

  public static parseJsonZeroCopy(buffer: ArrayBuffer, schemaName: string = 'Any'): Promise<any> {
     return jsonPool.runTask({ buffer, schemaName }, [buffer]);
  }
}
