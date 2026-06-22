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

// OTLP log export (native fetch, no opentelemetry SDK).
//
// Opt-in & graceful degradation: only export when a collector logs endpoint is
// configured. Resolution follows the OTel env-var spec:
//   OTEL_EXPORTER_OTLP_LOGS_ENDPOINT  (verbatim)
//   OTEL_EXPORTER_OTLP_ENDPOINT + '/v1/logs'
// When neither is set, the batch buffer is never populated and no background
// timer runs — zero overhead, and logs still go to the console below.
const logsEndpoint =
  process.env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT'] ??
  (process.env['OTEL_EXPORTER_OTLP_ENDPOINT']
    ? `${process.env['OTEL_EXPORTER_OTLP_ENDPOINT'].replace(/\/$/, '')}/v1/logs`
    : undefined);
const logExportEnabled = logsEndpoint !== undefined;

const telemetryBatch: LogPayload[] = [];

function flushTelemetry() {
  if (!logExportEnabled || telemetryBatch.length === 0) return;
  const batchToSend = [...telemetryBatch];
  telemetryBatch.length = 0;

  // Fire and forget native fetch. A missing/flaky collector must never break the
  // logger, so export errors are swallowed (and not re-logged → no feedback loop).
  fetch(logsEndpoint!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ logs: batchToSend }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    // Intentionally ignored.
  });
}

// Only run the flush timer when export is actually enabled.
if (logExportEnabled) {
  setInterval(flushTelemetry, 5000).unref();
}

function writeLog(
  level: LogLevel,
  message: string,
  meta: Record<string, any> = {},
  error?: Error | unknown,
) {
  const payload: LogPayload = {
    level,
    message,
    traceId: getTraceId() || meta['traceId'] || null,
    timestamp: new Date().toISOString(),
    ...meta,
  };

  if (error && error instanceof Error) {
    payload['error'] = {
      name: error.name,
      message: error.message,
      stack: config.isDevelopment ? error.stack : undefined,
    };
  } else if (error) {
    payload['error'] = error;
  }

  const output = JSON.stringify(payload);

  // Buffer for OTLP log export only when a collector is configured; otherwise the
  // buffer would grow unbounded with nothing draining it.
  if (logExportEnabled) {
    telemetryBatch.push(payload);
  }

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
  error: (message: string, meta?: Record<string, any>, error?: Error | unknown) =>
    writeLog('error', message, meta, error),
  warn: (message: string, meta?: Record<string, any>) => writeLog('warn', message, meta),
  debug: (message: string, meta?: Record<string, any>) => {
    if (config.isDevelopment) {
      writeLog('debug', message, meta);
    }
  },
};
