import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Dummy service to demonstrate mocking
class ExternalAIService {
  async fetchCompletion(prompt: string): Promise<string> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 50));
    return `Response for: ${prompt}`;
  }

  // Example of a function that could timeout
  async fetchWithTimeout(prompt: string, ms: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout')), ms);
      // Simulate real delay
      setTimeout(() => {
        clearTimeout(timer);
        resolve('Success');
      }, 100);
    });
  }
}

test('Mocking API responses with node:test', async (t) => {
  const service = new ExternalAIService();
  
  // 1. Method Mocking: t.mock.method
  // We mock the network call to always return a predefined response without waiting
  t.mock.method(service, 'fetchCompletion', async () => {
    return 'Mocked Response';
  });

  const result = await service.fetchCompletion('Hello World');
  assert.equal(result, 'Mocked Response', 'Should return the mocked response');
  
  // Verify it was called once
  const fetchMock = (service.fetchCompletion as any).mock;
  assert.equal(fetchMock.calls.length, 1, 'Mock should be called exactly once');
});

test('Mocking network timeouts using node:test mock.timers', async (t) => {
  // 2. Timer Mocking: mock.timers
  // This allows us to advance time instantaneously instead of waiting
  mock.timers.enable({ apis: ['setTimeout', 'clearTimeout'] });
  
  const service = new ExternalAIService();
  
  // We set a 50ms timeout. The function takes 100ms.
  const promise = service.fetchWithTimeout('Hello', 50);
  
  // Advance time by 51ms. This should trigger the timeout in fetchWithTimeout.
  mock.timers.tick(51);
  
  await assert.rejects(
    promise,
    (err: Error) => err.message === 'Timeout',
    'Should throw Timeout error because time was advanced beyond 50ms'
  );
  
  mock.timers.disable();
});
