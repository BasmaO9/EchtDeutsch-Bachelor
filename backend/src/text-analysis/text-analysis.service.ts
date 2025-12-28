import { Injectable } from '@nestjs/common';
import { ITextAnalyzer, CEFRAnalysisResult } from './text-analysis.interface';
import { TextAnalysisFactoryService, AnalyzerType } from './text-analysis-factory.service';

/**
 * Facade service for text analysis
 * Provides a simple interface for text analysis operations
 * Hides the complexity of analyzer selection and creation
 */
@Injectable()
export class TextAnalysisService {
  private analyzer: ITextAnalyzer;

  constructor(private readonly factory: TextAnalysisFactoryService) {
    // Initialize with default analyzer (DAFlex)
    this.analyzer = this.factory.getDefaultAnalyzer();
  }

  /**
   * Analyzes German text and returns CEFR level distribution
   * Uses the currently configured analyzer
   * @param text - The German text to analyze
   * @returns Promise resolving to CEFR level analysis results
   */
  async analyzeText(text: string): Promise<CEFRAnalysisResult> {
    return this.analyzer.analyzeText(text);
  }

  /**
   * Switches to a different analyzer type
   * Allows runtime switching of analyzers
   * @param type - The type of analyzer to use
   */
  setAnalyzer(type: AnalyzerType): void {
    this.analyzer = this.factory.createAnalyzer(type);
    console.log(`Switched to analyzer: ${type}`);
  }

  /**
   * Gets the current analyzer type
   * @returns The current analyzer type
   */
  getCurrentAnalyzerType(): AnalyzerType {
    // Since we default to DAFLEX, return that for now
    // In a more complex implementation, we could track the current type
    return AnalyzerType.DAFLEX;
  }
}

