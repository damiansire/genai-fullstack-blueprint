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
  let score = 0;
  for (const line of lines) {
    const indent = line.search(/\S/);
    if (indent === -1) continue;
    const depth = Math.floor(indent / 2);
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

// ─── Use Case ─────────────────────────────────────────────────────────────────

import { UseCase } from '../../core/UseCase.js';
import { modelFactory } from '../../infrastructure/ai/factory.js';

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

    logger.info('[CodeGen] Starting generation via LLM', { language, traceId, specLength: spec.length });

    const model = modelFactory.create('google-text-bison');
    const systemPrompt = `You are an expert ${language} developer. Output ONLY valid, production-ready ${language} code based on the user's specification. Do not use markdown backticks around the code. Do not provide explanations.`;

    const initialResponse = await model.process({
       prompt: `${systemPrompt}\n\nSpecification: ${spec}`,
       temperature: 0.2
    }, {});

    let code = initialResponse.result.text.trim();
    // remove markdown backticks if the model ignored instruction
    code = code.replace(/^```[a-z]*\n/i, '').replace(/\n```$/i, '');

    let rounds = 1;
    let metrics = this.analyze(code, language);

    // Refinement loop: if quality is low, ask LLM to fix it
    while (metrics.qualityScore < this.QUALITY_THRESHOLD && rounds < this.MAX_ROUNDS) {
      rounds++;
      
      const refinementPrompt = `${systemPrompt}\n\nYour previous code had a quality score of ${metrics.qualityScore}/100.
Please fix the following issues and return ONLY the complete fixed ${language} code without markdown backticks:
Security Smells: ${metrics.securitySmells.join(', ') || 'None'}
Code Smells: ${metrics.codeSmells.join(', ') || 'None'}
Cognitive Complexity: ${metrics.cognitiveComplexity}
      
Previous Code:
${code}`;

      logger.info(`[CodeGen] Refinement round ${rounds} requested`, { qualityScore: metrics.qualityScore, traceId });

      const refinementResponse = await model.process({
         prompt: refinementPrompt,
         temperature: 0.1
      }, {});
      
      code = refinementResponse.result.text.trim();
      code = code.replace(/^```[a-z]*\n/i, '').replace(/\n```$/i, '');
      metrics = this.analyze(code, language);
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
