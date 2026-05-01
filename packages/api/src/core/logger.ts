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
