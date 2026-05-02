/**
 * TelemetryStreamUseCase — Patrón 9: IoT Real-time Telemetry
 *
 * Produces a real-time SSE stream of simulated IoT sensor readings.
 * In production, replace the simulator with actual device adapter calls.
 *
 * Architecture:
 *   - Native Node.js setInterval() inside an AsyncGenerator
 *   - Each iteration yields a TelemetryFrame (1 frame per device)
 *   - The SSE route iterates the generator and writes `data:` events
 *   - AbortSignal propagation: client disconnect stops the generator immediately
 *
 * Simulated devices:
 *   - Temp/humidity sensors (warehouse monitoring)
 *   - Pressure sensors (pipeline monitoring)
 *   - Vibration sensors (machinery predictive maintenance)
 *   - Power meters (energy consumption)
 *   - GPS trackers (fleet / asset tracking)
 *
 * Anomaly detection (statistical):
 *   - Z-score > 2.5 → WARNING
 *   - Z-score > 4.0 → CRITICAL
 *   - Running mean + stddev computed in a rolling 20-sample window per device
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../../core/logger.js';
import { getContext } from '../../core/async-context.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DeviceType = 'temperature' | 'humidity' | 'pressure' | 'vibration' | 'power' | 'gps';
export type AlertLevel = 'NORMAL' | 'WARNING' | 'CRITICAL';

export interface TelemetryFrame {
  frameId: string;
  deviceId: string;
  deviceType: DeviceType;
  timestamp: string;
  value: number;
  unit: string;
  alertLevel: AlertLevel;
  location: string;
  metadata: Record<string, number | string>;
}

export interface DeviceConfig {
  id: string;
  type: DeviceType;
  unit: string;
  location: string;
  baseValue: number;
  amplitude: number;
  noiseLevel: number;
  periodMs: number;
}

// ─── Device Registry ─────────────────────────────────────────────────────────

export const DEVICES: DeviceConfig[] = [
  { id: 'TEMP-WH-001', type: 'temperature', unit: '°C',  location: 'Warehouse A',    baseValue: 22,   amplitude: 3,    noiseLevel: 0.3, periodMs: 8000  },
  { id: 'TEMP-WH-002', type: 'temperature', unit: '°C',  location: 'Warehouse B',    baseValue: 18,   amplitude: 5,    noiseLevel: 0.5, periodMs: 8000  },
  { id: 'HUM-WH-001',  type: 'humidity',    unit: '%RH', location: 'Warehouse A',    baseValue: 55,   amplitude: 8,    noiseLevel: 1.0, periodMs: 10000 },
  { id: 'PRES-PP-001', type: 'pressure',    unit: 'bar', location: 'Pipeline Seg-3', baseValue: 8.2,  amplitude: 0.5,  noiseLevel: 0.05,periodMs: 5000  },
  { id: 'VIB-MC-001',  type: 'vibration',   unit: 'g',   location: 'Machine Line-1', baseValue: 0.12, amplitude: 0.05, noiseLevel: 0.01,periodMs: 3000  },
  { id: 'PWR-FL-001',  type: 'power',       unit: 'kW',  location: 'Floor 1',        baseValue: 45,   amplitude: 12,   noiseLevel: 2.0, periodMs: 7000  },
  { id: 'GPS-TR-001',  type: 'gps',         unit: 'km/h',location: 'Route 66',       baseValue: 80,   amplitude: 20,   noiseLevel: 2.0, periodMs: 4000  },
];

// ─── Rolling Statistics (Z-score anomaly detection) ──────────────────────────

class RollingStats {
  private window: number[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 20) {
    this.maxSize = maxSize;
  }

  add(value: number): void {
    this.window.push(value);
    if (this.window.length > this.maxSize) this.window.shift();
  }

  mean(): number {
    if (this.window.length === 0) return 0;
    return this.window.reduce((a, b) => a + b, 0) / this.window.length;
  }

  stddev(): number {
    if (this.window.length < 2) return 1;
    const m = this.mean();
    const variance = this.window.reduce((sum, v) => sum + (v - m) ** 2, 0) / this.window.length;
    return Math.sqrt(variance) || 1;
  }

  zScore(value: number): number {
    return Math.abs((value - this.mean()) / this.stddev());
  }
}

// ─── Simulator ────────────────────────────────────────────────────────────────

/** Generates a sinusoidal value with Gaussian noise — simulates real sensor drift. */
function simulateReading(device: DeviceConfig, t: number): number {
  const sine = device.baseValue + device.amplitude * Math.sin(2 * Math.PI * t / 30000);
  const noise = (Math.random() - 0.5) * 2 * device.noiseLevel;
  // Inject random spike 1% of the time for anomaly testing
  const spike = Math.random() < 0.01 ? device.amplitude * (Math.random() > 0.5 ? 3 : -3) : 0;
  return Math.round((sine + noise + spike) * 1000) / 1000;
}

// ─── Use Case ─────────────────────────────────────────────────────────────────

export class TelemetryStreamUseCase {
  /**
   * Async generator that yields TelemetryFrames until the AbortSignal fires.
   * Emits frames at the minimum interval of all active devices.
   *
   * @param deviceIds  Filter to specific device IDs (empty = all devices)
   * @param signal     AbortSignal from the HTTP request (SSE disconnect)
   */
  async *stream(deviceIds: string[], signal: AbortSignal): AsyncGenerator<TelemetryFrame> {
    const traceId = getContext()?.traceId;
    const activeDevices = deviceIds.length > 0
      ? DEVICES.filter(d => deviceIds.includes(d.id))
      : DEVICES;

    if (activeDevices.length === 0) {
      logger.warn('[Telemetry] No matching devices', { deviceIds, traceId });
      return;
    }

    // Per-device rolling statistics for Z-score anomaly detection
    const stats = new Map<string, RollingStats>(
      activeDevices.map(d => [d.id, new RollingStats(20)])
    );

    // Per-device tick counter for sinusoidal simulation
    const ticks = new Map<string, number>(
      activeDevices.map(d => [d.id, 0])
    );

    // Per-device next-emit timestamp
    const nextEmit = new Map<string, number>(
      activeDevices.map(d => [d.id, Date.now()])
    );

    logger.info('[Telemetry] Stream started', {
      deviceCount: activeDevices.length,
      traceId,
    });

    const MIN_POLL_MS = 500;

    while (!signal.aborted) {
      const now = Date.now();

      for (const device of activeDevices) {
        const due = nextEmit.get(device.id) ?? 0;
        if (now < due) continue;

        // Advance tick
        const tick = (ticks.get(device.id) ?? 0) + device.periodMs;
        ticks.set(device.id, tick);

        const value = simulateReading(device, tick);
        const rollingStats = stats.get(device.id)!;
        rollingStats.add(value);

        const z = rollingStats.zScore(value);
        const alertLevel: AlertLevel =
          z > 4.0 ? 'CRITICAL' : z > 2.5 ? 'WARNING' : 'NORMAL';

        const frame: TelemetryFrame = {
          frameId: randomUUID(),
          deviceId: device.id,
          deviceType: device.type,
          timestamp: new Date().toISOString(),
          value,
          unit: device.unit,
          alertLevel,
          location: device.location,
          metadata: {
            rollingMean: Math.round(rollingStats.mean() * 1000) / 1000,
            rollingStddev: Math.round(rollingStats.stddev() * 1000) / 1000,
            zScore: Math.round(z * 100) / 100,
            sampleCount: (rollingStats as any).window?.length ?? 0,
          },
        };

        nextEmit.set(device.id, now + device.periodMs);
        yield frame;
      }

      // Yield control to the event loop before the next poll
      await new Promise<void>((resolve) => setTimeout(resolve, MIN_POLL_MS));
    }

    logger.info('[Telemetry] Stream ended (client disconnected)', { traceId });
  }

  /** Returns the static device registry for the UI device picker. */
  getDevices(): DeviceConfig[] {
    return DEVICES;
  }
}

export const telemetryStreamUseCase = new TelemetryStreamUseCase();
