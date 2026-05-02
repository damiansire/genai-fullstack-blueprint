import { TestBed } from '@angular/core/testing';
import { AiOrchestratorService } from './ai-orchestrator.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('AiOrchestratorService', () => {
  let service: AiOrchestratorService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AiOrchestratorService);

    // Mock document.startViewTransition
    if (!global.document) {
      (global as any).document = {};
    }
    
    global.document.startViewTransition = vi.fn((cb: any) => {
      cb();
      return { ready: Promise.resolve(), finished: Promise.resolve() } as any;
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
    // Act without awaiting to check immediate state
    const promise = service.handleAiIntent({});
    
    // In actual implementation, parseAsync throws due to empty object,
    // so we just expect the initial isLoading to be true before it resolves/rejects
    expect(service.isLoading()).toBe(true);
    
    try {
      await promise;
    } catch (e) {}
  });

  it('should reset state correctly', () => {
    // Arrange
    service.resetState(); // ensure it starts clean
    
    // Act
    service.resetState();
    
    // Assert
    expect(service.response()).toBeNull();
    expect(service.isLoading()).toBe(false);
    expect(service.error()).toBeNull();
    expect(global.document.startViewTransition).toHaveBeenCalled();
  });
});
