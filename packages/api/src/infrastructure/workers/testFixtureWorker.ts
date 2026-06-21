// Test-only worker fixture used by workerPool.test.ts.
//
// It reacts to the `cmd` field of each task message so the pool's
// success / error / timeout / crash-recovery paths can be exercised
// deterministically:
//
//   { cmd: 'echo',  value }  -> replies success with `value`
//   { cmd: 'fail',  reason } -> replies success:false with `reason`
//   { cmd: 'hang' }          -> never replies (drives the per-task timeout)
//   { cmd: 'crash' }         -> throws on the worker thread (process exit != 0)
import { isMainThread, parentPort } from 'node:worker_threads';

if (!isMainThread && parentPort) {
  parentPort.on('message', (msg: any) => {
    const { id, cmd } = msg;
    switch (cmd) {
      case 'echo':
        parentPort!.postMessage({ id, success: true, data: msg.value });
        break;
      case 'fail':
        parentPort!.postMessage({ id, success: false, error: msg.reason ?? 'failed' });
        break;
      case 'hang':
        // Intentionally never respond.
        break;
      case 'crash':
        // Uncaught throw -> 'error' then 'exit' with non-zero code.
        throw new Error('worker crashed');
      default:
        parentPort!.postMessage({ id, success: false, error: `unknown cmd: ${cmd}` });
    }
  });
}
