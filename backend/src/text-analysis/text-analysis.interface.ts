/**
 * Interface for text analysis services
 * Allows for easy replacement of analysis providers (DAFlex, etc.)
 */
export interface ITextAnalyzer {
  /**
   * Analyzes German text and returns CEFR level distribution
   * @param text - The German text to analyze
   * @returns Promise resolving to CEFR level counts
   */
  analyzeText(text: string): Promise<CEFRAnalysisResult>;
}

/**
 * Result of CEFR level analysis
 */
export interface CEFRAnalysisResult {
  total: number;
  counts: {
    A1: number;
    A2: number;
    B1: number;
    B2: number;
    C1: number;
    C2: number;
    UNKNOWN: number;
    IGNORED: number;
  };
  percentages: {
    A1: number;
    A2: number;
    B1: number;
    B2: number;
    C1: number;
    C2: number;
    UNKNOWN: number;
    IGNORED: number;
  };
}

