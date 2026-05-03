import { parentPort } from 'node:worker_threads';

if (!parentPort) {
  throw new Error('This file must be run as a worker thread');
}

parentPort.on('message', async (message) => {
  const { id, toolName, args } = message;

  try {
    let result;
    
    switch (toolName) {
      case 'calculate_fibonacci':
        const n = args.n || 30;
        const fib = (num: number): number => num <= 1 ? num : fib(num - 1) + fib(num - 2);
        result = fib(n);
        break;
      case 'render_chart':
        result = { type: 'bar', data: [10, 20, 30], label: args.label || 'Sales' };
        break;
      default:
        result = { error: `Tool ${toolName} not recognized` };
    }

    parentPort!.postMessage({ id, success: true, result });
  } catch (error) {
    parentPort!.postMessage({ id, success: false, error: String(error) });
  }
});
