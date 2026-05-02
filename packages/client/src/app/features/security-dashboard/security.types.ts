/**
 * Shared types for the Security Dashboard feature.
 * Mirrors the SecurityAnalysisReport from the API use case.
 */

export type ThreatSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface ThreatIndicator {
  category: string;
  technique: string;
  severity: ThreatSeverity;
  evidence: string[];
  confidence: number;
  recommendation: string;
}

export interface SecurityAnalysisReport {
  analysisId: string;
  timestamp: string;
  logLines: number;
  processingMs: number;
  overallSeverity: ThreatSeverity;
  riskScore: number;
  threats: ThreatIndicator[];
  summary: string;
  mitigations: string[];
}
