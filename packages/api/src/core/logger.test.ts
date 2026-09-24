// Stability: 1 - Experimental (node:test)
//
// Besides pinning the log contract, this file keeps the suite's coverage number
// stable. Every test process logs through writeLog() but hits different
// branches, so V8 reports that function's uncovered ranges with different
// extents per process. node merges those across processes pairwise
// (mergeCoverageRanges) in coverage-file order, which is PID order, i.e. random,
// and an uncovered range can survive or vanish depending on that order.
// Covering every reachable block of writeLog (both isDevelopment postures,
// every level) leaves no uncovered range for the merge to disagree about.
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { logger } from './logger.js';
import { config } from './config.js';
import { createRootContext, requestContext } from './async-context.js';

type ConsoleMethod = 'log' | 'warn' | 'error' | 'debug';

describe('logger', () => {
  const written: Record<ConsoleMethod, string[]> = { log: [], warn: [], error: [], debug: [] };

  beforeEach(() => {
    for (const method of Object.keys(written) as ConsoleMethod[]) {
      written[method] = [];
      mock.method(console, method, (line: string) => written[method].push(line));
    }
  });

  afterEach(() => {
    mock.restoreAll();
  });

  const lastLine = (method: ConsoleMethod) => JSON.parse(written[method].at(-1) ?? 'null');

  it('routes each level to its console method as one JSON line', () => {
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    assert.equal(lastLine('log').level, 'info');
    assert.equal(lastLine('warn').level, 'warn');
    assert.equal(lastLine('error').level, 'error');
    assert.match(lastLine('log').timestamp, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('takes the traceId from the async context, then from meta, else null', () => {
    requestContext.run(createRootContext('als-trace'), () => logger.info('in context'));
    assert.equal(lastLine('log').traceId, 'als-trace');

    logger.info('meta only', { traceId: 'meta-trace' });
    assert.equal(lastLine('log').traceId, 'meta-trace');

    logger.info('no trace');
    assert.equal(lastLine('log').traceId, null);
  });

  it('serializes an Error without its stack outside development', () => {
    mock.property(config, 'isDevelopment', false);
    logger.error('failed', { op: 'x' }, new TypeError('bad input'));

    const line = lastLine('error');
    assert.equal(line.op, 'x');
    assert.equal(line.error.name, 'TypeError');
    assert.equal(line.error.message, 'bad input');
    assert.equal('stack' in line.error, false, 'a stack trace must not leak to prod logs');
  });

  it('includes the stack of an Error in development', () => {
    mock.property(config, 'isDevelopment', true);
    logger.error('failed', {}, new Error('boom'));
    assert.match(lastLine('error').error.stack, /Error: boom/);
  });

  it('passes a non-Error rejection value through untouched', () => {
    logger.error('failed', {}, { code: 42 });
    assert.deepEqual(lastLine('error').error, { code: 42 });
  });

  it('drops debug outside development', () => {
    mock.property(config, 'isDevelopment', false);
    logger.debug('d');
    assert.equal(written.debug.length, 0);
  });

  it('emits debug in development', () => {
    mock.property(config, 'isDevelopment', true);
    logger.debug('d');
    assert.equal(lastLine('debug').level, 'debug');
  });
});
