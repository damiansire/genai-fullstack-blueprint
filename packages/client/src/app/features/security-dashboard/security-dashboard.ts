/**
 * SecurityDashboard — Patrón 7: AI-Powered Security Analysis (Frontend)
 *
 * Allows pasting raw logs, submits to POST /api/domain/security/analyze,
 * and renders the SecurityAnalysisReport with:
 *   - Overall severity badge (color-coded)
 *   - Risk score gauge (CSS-animated arc)
 *   - MITRE ATT&CK threat cards with evidence + confidence bars
 *   - Mitigation checklist
 *   - Sample log injection for quick testing
 */
import {
  Component,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { API_CONFIG } from '../../core/tokens/api-config';
import type {
  SecurityAnalysisReport,
  ThreatSeverity,
} from './security.types';

const SAMPLE_LOGS = `Failed password for invalid user admin from 192.168.1.45 port 43210 ssh2
Failed password for root from 10.0.0.99 port 22 ssh2
Failed password for ubuntu from 192.168.1.45 port 43211 ssh2
POST /login HTTP/1.1 200 - "' OR '1'='1; DROP TABLE users;--"
GET /etc/passwd HTTP/1.1 404 - "../../etc/passwd"
authentication failure; logname= uid=0 euid=0 tty=ssh ruser= rhost=10.0.0.42 user=root
sudo: authentication failure; terminal=pts/0 uid=1001; command=/bin/bash
DNS TXT query beacon.evil-c2.com from 172.16.0.55
bytes_sent=15728640 dst_ip=203.0.113.5 dst_port=4444
<script>document.cookie='stolen='+document.cookie</script>`;

@Component({
  selector: 'app-security-dashboard',
  imports: [DecimalPipe],
  templateUrl: './security-dashboard.html',
  styleUrl: './security-dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecurityDashboard {
  private readonly apiConfig = inject(API_CONFIG);

  // ─── Form state ──────────────────────────────────────────────────────────
  logs = signal('');
  isAnalyzing = signal(false);
  report = signal<SecurityAnalysisReport | null>(null);
  analysisError = signal<string | null>(null);

  // ─── UI helpers ───────────────────────────────────────────────────────────
  readonly hasLogs = computed(() => this.logs().trim().length > 0);
  readonly logLineCount = computed(() =>
    this.logs().split('\n').filter(l => l.trim()).length
  );

  readonly severityColor = computed(() => {
    const s = this.report()?.overallSeverity;
    return {
      CRITICAL: '#ef4444',
      HIGH: '#f97316',
      MEDIUM: '#eab308',
      LOW: '#22c55e',
      INFO: '#6b7280',
    }[s ?? 'INFO'];
  });

  readonly riskGradient = computed(() => {
    const score = this.report()?.riskScore ?? 0;
    const color = score >= 70 ? '#ef4444' : score >= 40 ? '#f97316' : '#22c55e';
    return `conic-gradient(${color} ${score * 3.6}deg, rgba(255,255,255,0.08) 0deg)`;
  });

  onLogsInput(event: Event): void {
    this.logs.set((event.target as HTMLTextAreaElement).value);
  }

  loadSample(): void {
    this.logs.set(SAMPLE_LOGS);
  }

  clearAll(): void {
    this.logs.set('');
    this.report.set(null);
    this.analysisError.set(null);
  }

  async analyze(): Promise<void> {
    if (!this.hasLogs()) return;
    this.isAnalyzing.set(true);
    this.report.set(null);
    this.analysisError.set(null);

    try {
      const res = await fetch(`${this.apiConfig.baseUrl}/domain/security/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: this.logs() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      this.report.set(await res.json());
    } catch (err) {
      this.analysisError.set(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      this.isAnalyzing.set(false);
    }
  }

  severityClass(severity: ThreatSeverity): string {
    return `badge badge--${severity.toLowerCase()}`;
  }

  confidenceWidth(confidence: number): string {
    return `${Math.round(confidence * 100)}%`;
  }

  trackByCategory(_: number, t: { category: string }) {
    return t.category;
  }
}
