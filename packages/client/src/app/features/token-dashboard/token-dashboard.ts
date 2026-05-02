import { Component, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { API_CONFIG } from '../../core/tokens/api-config';
import { CommonModule } from '@angular/common';

interface QuotaResponse {
  tenantId: string;
  maxTokens: number;
  availableTokens: number;
  usedTokens: number;
  lastRefill: string;
  usagePercentage: number;
}

@Component({
  selector: 'app-token-dashboard',
  imports: [CommonModule],
  templateUrl: './token-dashboard.html',
  styleUrl: './token-dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TokenDashboard {
  private readonly apiConfig = inject(API_CONFIG);

  quotaResource = httpResource<QuotaResponse>(() => ({
    url: `${this.apiConfig.baseUrl}/user/quota`,
    method: 'GET'
  }));

  quota = computed(() => this.quotaResource.value());
  isLoading = computed(() => this.quotaResource.isLoading());

  // Helper for UI ring visualization
  strokeDashoffset = computed(() => {
    const q = this.quota();
    if (!q) return 283; // full ring
    const percentage = q.usagePercentage;
    return 283 - (283 * percentage) / 100;
  });

  statusColor = computed(() => {
    const q = this.quota();
    if (!q) return 'var(--primary-color)';
    if (q.usagePercentage > 90) return '#ff4757'; // red
    if (q.usagePercentage > 75) return '#ffa502'; // orange
    return 'var(--primary-color)';
  });
}
