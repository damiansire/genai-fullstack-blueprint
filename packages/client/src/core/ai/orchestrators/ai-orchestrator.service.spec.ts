import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AiOrchestratorService } from './ai-orchestrator.service';

/**
 * Pure unit test for the orchestrator: the service has no constructor
 * dependencies, so we instantiate it directly instead of booting Angular's
 * TestBed. This keeps the test zoneless and free of the Angular compiler,
 * matching the repo convention of testing domain logic without the UI.
 */
describe('AiOrchestratorService', () => {
  let service: AiOrchestratorService;

  beforeEach(() => {
    service = new AiOrchestratorService();

    // Stub the View Transitions API (not present under jsdom) so state
    // transitions run synchronously.
    (globalThis as any).document = (globalThis as any).document ?? {};
    (globalThis as any).document.startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return {
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        finished: Promise.resolve(),
        skipTransition: () => {},
      };
    });
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should have initial state', () => {
    expect(service.response()).toBeNull();
    expect(service.isLoading()).toBe(false);
    expect(service.error()).toBeNull();
    expect(service.requiresHumanApproval()).toBe(false);
  });

  it('should update state to loading when handling intent', async () => {
    // Act without awaiting to observe the immediate (synchronous) loading state.
    const promise = service.handleAiIntent({});

    expect(service.isLoading()).toBe(true);

    // Empty payload fails Zod validation; the use case degrades gracefully.
    await promise;

    expect(service.isLoading()).toBe(false);
    expect(service.error()).not.toBeNull();
  });

  it('should reset state correctly', () => {
    service.resetState();

    expect(service.response()).toBeNull();
    expect(service.isLoading()).toBe(false);
    expect(service.error()).toBeNull();
    expect((globalThis as any).document.startViewTransition).toHaveBeenCalled();
  });
});
