// Stability: 2 - Stable (node:async_hooks - AsyncLocalStorage)
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  traceId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getTraceId(): string | undefined {
  return requestContext.getStore()?.traceId;
}
