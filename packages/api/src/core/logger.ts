import { getTraceId } from './async-context.js';
import { config } from './config.js';

type LogLevel = 'info' | 'error' | 'warn' | 'debug';

interface LogPayload {
  level: LogLevel;
  message: string;
  traceId?: string | null;
  timestamp: string;
  [key: string]: any;
}

// OTLP Telemetry Exporter Simulator (Native fetch, no opentelemetry SDK)
const telemetryBatch: LogPayload[] = [];
const OTLP_ENDPOINT = process.env['OTLP_ENDPOINT'] || 'http://localhost:4318/v1/logs';

function flushTelemetry() {
  if (telemetryBatch.length === 0) return;
  const batchToSend = [...telemetryBatch];
  telemetryBatch.length = 0;

  // Fire and forget native fetch
  fetch(OTLP_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ logs: batchToSend })
  }).catch(() => {
    // Silently ignore telemetry export errors so they don't loop back into the logger
  });
}

// Flush every 5 seconds
setInterval(flushTelemetry, 5000).unref();

function writeLog(level: LogLevel, message: string, meta: Record<string, any> = {}, error?: Error | unknown) {
  const payload: LogPayload = {
    level,
    message,
    traceId: getTraceId() || meta['traceId'] || null,
    timestamp: new Date().toISOString(),
    ...meta
  };

  if (error && error instanceof Error) {
    payload['error'] = {
      name: error.name,
      message: error.message,
      stack: config.isDevelopment ? error.stack : undefined
    };
  } else if (error) {
    payload['error'] = error;
  }

  const output = JSON.stringify(payload);
  
  // Push to telemetry batch
  telemetryBatch.push(payload);

  switch (level) {
    case 'error':
      console.error(output);
      break;
    case 'warn':
      console.warn(output);
      break;
    case 'debug':
      console.debug(output);
      break;
    default:
      console.log(output);
      break;
  }
}

export const logger = {
  info: (message: string, meta?: Record<string, any>) => writeLog('info', message, meta),
  error: (message: string, meta?: Record<string, any>, error?: Error | unknown) => writeLog('error', message, meta, error),
  warn: (message: string, meta?: Record<string, any>) => writeLog('warn', message, meta),
  debug: (message: string, meta?: Record<string, any>) => {
    if (config.isDevelopment) {
      writeLog('debug', message, meta);
    }
  }
};
