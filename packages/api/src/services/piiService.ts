import { createHash } from 'node:crypto';

/**
 * Service for native PII (Personally Identifiable Information) Redaction.
 * Uses native RegExp for NER (Named Entity Recognition) approximation
 * and crypto hashing to mask sensitive corporate/personal data before it leaves the network.
 */
export class PIIService {
  private static instance: PIIService;

  private constructor() {}

  public static getInstance(): PIIService {
    if (!PIIService.instance) {
      PIIService.instance = new PIIService();
    }
    return PIIService.instance;
  }

  // Very basic approximations for demonstration purposes.
  // In a real scenario, this would use a robust dictionary or local SLM.
  private readonly piiRegex = [
    // Emails
    { type: 'EMAIL', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
    // SSN / ID approximation
    { type: 'ID_NUMBER', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
    // Credit Cards (simplified)
    { type: 'CREDIT_CARD', regex: /\b(?:\d[ -]*?){13,16}\b/g },
    // Phone numbers (simplified)
    { type: 'PHONE', regex: /\b\+?1?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
  ];

  public redact(text: string): { redactedText: string; mapping: Record<string, string> } {
    if (!text || typeof text !== 'string') {
      return { redactedText: text, mapping: {} };
    }

    let redactedText = text;
    const mapping: Record<string, string> = {};

    for (const { type, regex } of this.piiRegex) {
      redactedText = redactedText.replace(regex, (match) => {
        // Create an immutable, deterministic hash
        const hash = createHash('sha256').update(match).digest('hex').substring(0, 8);
        const token = `<${type}:${hash}>`;
        mapping[token] = match;
        return token;
      });
    }

    return { redactedText, mapping };
  }

  public unredact(text: string, mapping: Record<string, string>): string {
    if (!text || typeof text !== 'string') return text;

    let unredactedText = text;
    for (const [token, originalValue] of Object.entries(mapping)) {
      unredactedText = unredactedText.split(token).join(originalValue);
    }
    return unredactedText;
  }
}

export const piiService = PIIService.getInstance();
