/**
 * IotDashboard — Patrón 9: IoT Real-time Telemetry (Frontend)
 *
 * Connects to GET /api/domain/telemetry/stream via native EventSource.
 * Renders live device cards that update in place (no full re-render).
 */
import {
  Component,
  signal,
  computed,
  inject,
  OnDestroy,
  ChangeDetectionStrategy,
} from '@angular/core';
import { API_CONFIG } from '../../core/tokens/api-config';

type AlertLevel = 'NORMAL' | 'WARNING' | 'CRITICAL';

interface TelemetryFrame {
  frameId: string;
  deviceId: string;
  deviceType: string;
  timestamp: string;
  value: number;
  unit: string;
  alertLevel: AlertLevel;
  location: string;
  metadata: { rollingMean: number; rollingStddev: number; zScore: number; sampleCount: number };
}

interface DeviceConfig {
  id: string;
  type: string;
  unit: string;
  location: string;
  baseValue: number;
}

interface DeviceState {
  config: DeviceConfig;
  latest: TelemetryFrame | null;
  history: number[];  // last 20 values for sparkline
  frameCount: number;
}

const HISTORY_SIZE = 20;
const DEVICE_TYPE_ICONS: Record<string, string> = {
  temperature: '🌡️', humidity: '💧', pressure: '🔵',
  vibration: '〰️', power: '⚡', gps: '📍', default: '📡',
};

@Component({
  selector: 'app-iot-dashboard',
  standalone: true,
  imports: [],
  templateUrl: './iot-dashboard.html',
  styleUrl: './iot-dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IotDashboard implements OnDestroy {
  private readonly apiConfig = inject(API_CONFIG);
  private eventSource: EventSource | null = null;

  // ─── State ───────────────────────────────────────────────────────────────
  isStreaming = signal(false);
  devices = signal<Map<string, DeviceState>>(new Map());
  totalFrames = signal(0);
  alerts = signal<TelemetryFrame[]>([]);
  connectionError = signal<string | null>(null);

  // ─── Computed ────────────────────────────────────────────────────────────
  readonly deviceList = computed(() => Array.from(this.devices().values()));
  readonly alertCount = computed(() => this.alerts().length);
  readonly criticalCount = computed(() =>
    this.alerts().filter(a => a.alertLevel === 'CRITICAL').length
  );
  readonly hasAlerts = computed(() => this.alertCount() > 0);

  // ─── Helpers ─────────────────────────────────────────────────────────────
  deviceIcon(type: string): string {
    return DEVICE_TYPE_ICONS[type] ?? DEVICE_TYPE_ICONS['default']!;
  }

  alertClass(level: AlertLevel): string {
    return `alert-badge alert-badge--${level.toLowerCase()}`;
  }

  cardClass(state: DeviceState): string {
    const level = state.latest?.alertLevel ?? 'NORMAL';
    return `device-card device-card--${level.toLowerCase()}`;
  }

  /** Generates an SVG polyline path from history values for a sparkline. */
  sparklinePath(history: number[]): string {
    if (history.length < 2) return '';
    const w = 120, h = 32;
    const min = Math.min(...history);
    const max = Math.max(...history) || min + 1;
    const points = history.map((v, i) => {
      const x = (i / (history.length - 1)) * w;
      const y = h - ((v - min) / (max - min)) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return points.join(' ');
  }

  trackById(_: number, d: DeviceState): string {
    return d.config.id;
  }

  // ─── Stream control ───────────────────────────────────────────────────────
  startStream(): void {
    if (this.eventSource) this.stopStream();

    this.isStreaming.set(true);
    this.connectionError.set(null);
    this.totalFrames.set(0);
    this.alerts.set([]);

    const url = `${this.apiConfig.baseUrl}/domain/telemetry/stream`;
    this.eventSource = new EventSource(url);

    // First event: device list (bootstrap)
    this.eventSource.addEventListener('devices', (e) => {
      const deviceConfigs: DeviceConfig[] = JSON.parse(e.data);
      const map = new Map<string, DeviceState>();
      for (const config of deviceConfigs) {
        map.set(config.id, { config, latest: null, history: [], frameCount: 0 });
      }
      this.devices.set(map);
    });

    // Default events: telemetry frames
    this.eventSource.onmessage = (e) => {
      const frame: TelemetryFrame = JSON.parse(e.data);
      this.totalFrames.update(n => n + 1);

      // Update device state immutably (new Map for Signal change detection)
      const map = new Map(this.devices());
      const state = map.get(frame.deviceId);
      if (state) {
        const history = [...state.history, frame.value].slice(-HISTORY_SIZE);
        map.set(frame.deviceId, {
          ...state,
          latest: frame,
          history,
          frameCount: state.frameCount + 1,
        });
        this.devices.set(map);
      }

      // Track alerts
      if (frame.alertLevel !== 'NORMAL') {
        this.alerts.update(prev => [frame, ...prev].slice(0, 50));
      }
    };

    this.eventSource.onerror = () => {
      this.connectionError.set('Stream connection lost. Click Start to reconnect.');
      this.isStreaming.set(false);
      this.eventSource?.close();
      this.eventSource = null;
    };
  }

  stopStream(): void {
    this.eventSource?.close();
    this.eventSource = null;
    this.isStreaming.set(false);
  }

  dismissAlerts(): void {
    this.alerts.set([]);
  }

  ngOnDestroy(): void {
    this.stopStream();
  }
}
