export interface TokenStore {
  /**
   * Add consumed tokens to the identifier's current window.
   * @param identifier - IP or API Key
   * @param tokens - Number of tokens consumed
   * @param windowMs - Time window in milliseconds
   */
  consume(identifier: string, tokens: number, windowMs: number): Promise<void>;

  /**
   * Get the total tokens consumed by the identifier in the current window.
   * @param identifier - IP or API Key
   * @param windowMs - Time window in milliseconds
   * @returns Current token count
   */
  getConsumedTokens(identifier: string, windowMs: number): Promise<number>;
}
