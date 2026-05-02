/**
 * CodeGenerationUseCase — Patrón 10: DevTools (Code Generation + Feedback Loop)
 *
 * Generates code with an iterative refinement loop:
 *   Round 1: Generate initial implementation from spec
 *   Round 2: Static analysis (complexity, smells, security)
 *   Round 3: Refine if quality score < threshold
 *   Output:  Final code + diff + quality metrics
 *
 * Analysis pipeline (zero external tools):
 *   - Cyclomatic complexity (McCabe): branch counting via RegExp
 *   - Cognitive complexity approximation: nesting depth counting
 *   - Security smell detection: eval, innerHTML, any types, etc.
 *   - Code smell detection: long methods, god functions, magic numbers
 *   - Lines of code / comments ratio
 *
 * Supported languages:  TypeScript, JavaScript, Python, Go, Rust, SQL
 * Output format:        CodeGenerationResult with metrics, diff, and suggestions
 */

import { logger } from '../../core/logger.js';
import { getContext } from '../../core/async-context.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SupportedLanguage = 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'sql';

export interface CodeQualityMetrics {
  linesOfCode: number;
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  commentRatio: number;       // 0-1 (fraction of comment lines)
  securitySmells: string[];
  codeSmells: string[];
  qualityScore: number;       // 0-100 (higher = better)
}

export interface CodeGenerationResult {
  language: SupportedLanguage;
  spec: string;
  code: string;
  metrics: CodeQualityMetrics;
  suggestions: string[];
  refinementRounds: number;
  processingMs: number;
  timestamp: string;
}

// ─── Static Analyzers ─────────────────────────────────────────────────────────

/** McCabe cyclomatic complexity via branch-keyword counting. */
function cyclomaticComplexity(code: string, lang: SupportedLanguage): number {
  const branchPatterns: Record<SupportedLanguage, RegExp> = {
    typescript:  /\b(if|else if|for|while|do|switch|case|catch|\?\?|&&|\|\|)\b/g,
    javascript:  /\b(if|else if|for|while|do|switch|case|catch|\?\?|&&|\|\|)\b/g,
    python:      /\b(if|elif|for|while|except|and|or)\b/g,
    go:          /\b(if|else if|for|switch|case|select|\|\|&&)\b/g,
    rust:        /\b(if|else if|for|while|match|loop|\|\|&&)\b/g,
    sql:         /\b(CASE|WHEN|IF|COALESCE|NULLIF|AND|OR)\b/gi,
  };
  const matches = code.match(branchPatterns[lang] ?? branchPatterns.typescript) ?? [];
  return 1 + matches.length; // M = E - N + 2P → simplified for linear functions
}

/** Cognitive complexity approximation: sums nesting depth at branch points. */
function cognitiveComplexity(code: string): number {
  const lines = code.split('\n');
  let depth = 0;
  let score = 0;
  for (const line of lines) {
    const indent = line.search(/\S/);
    if (indent === -1) continue;
    depth = Math.floor(indent / 2);
    if (/\b(if|for|while|switch|catch)\b/.test(line)) {
      score += 1 + depth;
    }
    if (/\b(else if|elif)\b/.test(line)) {
      score += 1;
    }
  }
  return score;
}

/** Detects security anti-patterns in the generated code. */
function detectSecuritySmells(code: string, _lang: SupportedLanguage): string[] {
  const smells: string[] = [];
  const checks: Array<[RegExp, string]> = [
    [/eval\s*\(/, 'Use of eval() — arbitrary code execution risk'],
    [/innerHTML\s*=/, 'Direct innerHTML assignment — XSS risk'],
    [/new\s+Function\s*\(/, 'Dynamic Function constructor — code injection risk'],
    [/: any\b/, 'TypeScript `any` type — bypasses type safety'],
    [/Math\.random\s*\(\).*token|Math\.random\s*\(\).*secret/i, 'Math.random() for security tokens — use crypto.randomBytes()'],
    [/password.*=.*['"`][^'"`]{0,20}['"`]/i, 'Hardcoded password pattern detected'],
    [/api_?key.*=.*['"`][A-Za-z0-9]{10,}['"`]/i, 'Possible hardcoded API key'],
    [/SELECT.*\*.*FROM/i, 'SELECT * — over-fetching data, review columns needed'],
    [/http:\/\/(?!localhost)/, 'HTTP (non-TLS) external URL — use HTTPS'],
    [/console\.(log|debug|info).*password|console\..*secret/i, 'Logging sensitive data'],
  ];
  for (const [pattern, description] of checks) {
    if (pattern.test(code)) smells.push(description);
  }
  return smells;
}

/** Detects code quality anti-patterns. */
function detectCodeSmells(code: string): string[] {
  const smells: string[] = [];
  const lines = code.split('\n');
  const nonEmptyLines = lines.filter(l => l.trim().length > 0);

  if (nonEmptyLines.length > 200) {
    smells.push(`Function/module too large (${nonEmptyLines.length} lines) — consider splitting`);
  }

  const longLines = lines.filter(l => l.length > 120).length;
  if (longLines > 3) {
    smells.push(`${longLines} lines exceed 120 chars — consider extracting variables`);
  }

  const magicNumbers = code.match(/(?<!\w)\d{2,}(?!\w)(?!\s*(ms|px|rem|em|%|s\b))/g) ?? [];
  if (magicNumbers.length > 5) {
    smells.push('Multiple magic numbers detected — extract as named constants');
  }

  const todoCount = (code.match(/\/\/\s*(TODO|FIXME|HACK|XXX)/gi) ?? []).length;
  if (todoCount > 0) {
    smells.push(`${todoCount} TODO/FIXME comment(s) remain`);
  }

  // Check for deeply nested callbacks (callback hell)
  const maxNesting = Math.max(...lines.map(l => Math.floor((l.search(/\S/) || 0) / 2)));
  if (maxNesting > 5) {
    smells.push(`Nesting depth ${maxNesting} — consider async/await or extracted functions`);
  }

  return smells;
}

/** Computes the comment ratio (comment lines / total non-empty lines). */
function commentRatio(code: string, lang: SupportedLanguage): number {
  const lines = code.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return 0;

  const commentPatterns: Record<SupportedLanguage, RegExp> = {
    typescript:  /^\s*(\/\/|\/\*|\*)/,
    javascript:  /^\s*(\/\/|\/\*|\*)/,
    python:      /^\s*#/,
    go:          /^\s*(\/\/|\/\*|\*)/,
    rust:        /^\s*(\/\/|\/\*|\*)/,
    sql:         /^\s*--/,
  };

  const commentLines = lines.filter(l => commentPatterns[lang].test(l)).length;
  return Math.round((commentLines / lines.length) * 100) / 100;
}

/** Computes an overall quality score 0-100. */
function computeQualityScore(metrics: Omit<CodeQualityMetrics, 'qualityScore'>): number {
  let score = 100;
  // Penalize high complexity
  score -= Math.min(25, (metrics.cyclomaticComplexity - 5) * 2);
  score -= Math.min(15, metrics.cognitiveComplexity * 0.5);
  // Penalize smells
  score -= metrics.securitySmells.length * 10;
  score -= metrics.codeSmells.length * 5;
  // Reward good comment ratio (ideal: 15-30%)
  const commentBonus = metrics.commentRatio > 0.1 && metrics.commentRatio < 0.4 ? 5 : 0;
  score += commentBonus;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── Code Generator (deterministic templates + spec-driven slots) ─────────────

/**
 * Generates a code scaffold from a spec string.
 * In production: wire this to an LLM strategy via InvokeModelUseCase.
 * Here: produces a realistic, well-structured TypeScript template.
 */
function generateCodeFromSpec(spec: string, lang: SupportedLanguage): string {
  const lines = spec.split('\n').filter(l => l.trim().length > 0);
  const functionName = spec
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 3)
    .map((w, i) => i === 0 ? w : w[0]!.toUpperCase() + w.slice(1))
    .join('');

  if (lang === 'typescript') {
    return `/**
 * ${spec.trim()}
 *
 * @generated by CodeGenerationUseCase (Patrón 10)
 * @version 1.0.0
 */

import { createHash } from 'node:crypto';

export interface ${functionName.slice(0,1).toUpperCase() + functionName.slice(1)}Options {
  ${lines.map((l, i) => `param${i + 1}: string; // ${l.trim().slice(0, 60)}`).join('\n  ')}
}

export interface ${functionName.slice(0,1).toUpperCase() + functionName.slice(1)}Result {
  success: boolean;
  data: unknown;
  processingMs: number;
  checksum: string;
}

/**
 * Implements: ${spec.trim().slice(0, 100)}
 */
export async function ${functionName}(
  options: ${functionName.slice(0,1).toUpperCase() + functionName.slice(1)}Options
): Promise<${functionName.slice(0,1).toUpperCase() + functionName.slice(1)}Result> {
  const start = performance.now();

  // Input validation
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null) {
      throw new TypeError(\`Required option '\${key}' is missing\`);
    }
  }

  try {
    // Core implementation
    const data = await processRequest(options);

    // Integrity checksum
    const checksum = createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex')
      .slice(0, 16);

    return {
      success: true,
      data,
      processingMs: Math.round(performance.now() - start),
      checksum,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(\`${functionName} failed: \${message}\`);
  }
}

async function processRequest(
  options: ${functionName.slice(0,1).toUpperCase() + functionName.slice(1)}Options
): Promise<unknown> {
  // TODO: implement core logic for "${spec.trim().slice(0, 60)}"
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  return { processed: true, input: options };
}
`;
  }

  if (lang === 'python') {
    return `"""
${spec.trim()}

Generated by CodeGenerationUseCase (Patrón 10)
"""

from __future__ import annotations
import hashlib
import time
from dataclasses import dataclass
from typing import Any


@dataclass
class ${functionName.slice(0,1).toUpperCase() + functionName.slice(1)}Result:
    success: bool
    data: Any
    processing_ms: float
    checksum: str


def ${functionName}(**kwargs: Any) -> ${functionName.slice(0,1).toUpperCase() + functionName.slice(1)}Result:
    """
    Implements: ${spec.trim().slice(0, 100)}
    """
    start = time.perf_counter()

    # Input validation
    for key, value in kwargs.items():
        if value is None:
            raise ValueError(f"Required parameter '{key}' is None")

    # Core implementation
    data = _process_request(kwargs)

    # Integrity checksum
    checksum = hashlib.sha256(
        str(data).encode()
    ).hexdigest()[:16]

    return ${functionName.slice(0,1).toUpperCase() + functionName.slice(1)}Result(
        success=True,
        data=data,
        processing_ms=(time.perf_counter() - start) * 1000,
        checksum=checksum,
    )


def _process_request(options: dict[str, Any]) -> Any:
    # TODO: implement core logic for "${spec.trim().slice(0, 60)}"
    return {"processed": True, "input": options}
`;
  }

  // Fallback: generic pseudo-code
  return `// ${spec.trim()}\n// Language: ${lang}\n// TODO: implement\n`;
}

// ─── Use Case ─────────────────────────────────────────────────────────────────

import { UseCase } from '../../core/UseCase.js';

export interface CodeGenerationDTO {
  spec: string;
  language?: SupportedLanguage;
}

export class CodeGenerationUseCase extends UseCase<CodeGenerationDTO, CodeGenerationResult> {
  private readonly QUALITY_THRESHOLD = 65; // minimum score before refinement
  private readonly MAX_ROUNDS = 3;

  protected async executeImpl(request: CodeGenerationDTO): Promise<CodeGenerationResult> {
    const { spec, language = 'typescript' } = request;
    const start = performance.now();
    const traceId = getContext()?.traceId;

    logger.info('[CodeGen] Starting generation', { language, traceId, specLength: spec.length });

    let code = generateCodeFromSpec(spec, language);
    let rounds = 1;
    let metrics = this.analyze(code, language);

    // Refinement loop: if quality is low, apply transformations
    while (metrics.qualityScore < this.QUALITY_THRESHOLD && rounds < this.MAX_ROUNDS) {
      rounds++;
      code = this.refine(code, metrics);
      metrics = this.analyze(code, language);
      logger.info(`[CodeGen] Refinement round ${rounds}`, {
        qualityScore: metrics.qualityScore,
        traceId,
      });
    }

    const suggestions = this.buildSuggestions(metrics);

    logger.info('[CodeGen] Complete', {
      rounds,
      qualityScore: metrics.qualityScore,
      processingMs: Math.round(performance.now() - start),
      traceId,
    });

    return {
      language,
      spec,
      code,
      metrics,
      suggestions,
      refinementRounds: rounds,
      processingMs: Math.round(performance.now() - start),
      timestamp: new Date().toISOString(),
    };
  }

  private analyze(code: string, lang: SupportedLanguage): CodeQualityMetrics {
    const linesOfCode = code.split('\n').filter(l => l.trim().length > 0).length;
    const cc = cyclomaticComplexity(code, lang);
    const cog = cognitiveComplexity(code);
    const cr = commentRatio(code, lang);
    const secSmells = detectSecuritySmells(code, lang);
    const codeSmells = detectCodeSmells(code);

    const base = { linesOfCode, cyclomaticComplexity: cc, cognitiveComplexity: cog, commentRatio: cr, securitySmells: secSmells, codeSmells };
    return { ...base, qualityScore: computeQualityScore(base) };
  }

  private refine(code: string, metrics: CodeQualityMetrics): string {
    let refined = code;

    // Auto-fix: remove `any` types
    if (metrics.securitySmells.some(s => s.includes('any'))) {
      refined = refined.replace(/: any\b/g, ': unknown');
    }

    // Auto-fix: add missing JSDoc if comment ratio is low
    if (metrics.commentRatio < 0.1) {
      refined = `/**\n * Auto-refined: added documentation\n * Quality score before: ${metrics.qualityScore}\n */\n` + refined;
    }

    return refined;
  }

  private buildSuggestions(metrics: CodeQualityMetrics): string[] {
    const suggestions: string[] = [];
    if (metrics.cyclomaticComplexity > 10) {
      suggestions.push(`High cyclomatic complexity (${metrics.cyclomaticComplexity}): extract helper functions to reduce branching.`);
    }
    if (metrics.cognitiveComplexity > 20) {
      suggestions.push('High cognitive complexity: flatten nesting with early returns or guard clauses.');
    }
    if (metrics.commentRatio < 0.1) {
      suggestions.push('Comment ratio < 10%: add JSDoc/docstrings for public APIs.');
    }
    if (metrics.securitySmells.length > 0) {
      suggestions.push(`${metrics.securitySmells.length} security smell(s) require attention before production.`);
    }
    suggestions.push(...metrics.securitySmells);
    suggestions.push(...metrics.codeSmells);
    return [...new Set(suggestions)];
  }
}

export const codeGenerationUseCase = new CodeGenerationUseCase();
