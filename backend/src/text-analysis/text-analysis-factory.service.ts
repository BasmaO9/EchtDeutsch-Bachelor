import { Injectable } from '@nestjs/common';
import { ITextAnalyzer } from './text-analysis.interface';
import { DaflexAnalyzerService } from './daflex-analyzer.service';

/**
 * Supported analyzer types
 */
export enum AnalyzerType {
  DAFLEX = 'daflex',
  // Add more analyzer types here as needed
  // CUSTOM = 'custom',
}

/**
 * Factory for creating text analyzer instances
 * Uses Factory pattern to allow easy replacement of analyzers
 */
@Injectable()
export class TextAnalysisFactoryService {
  constructor(private readonly daflexAnalyzer: DaflexAnalyzerService) {}

  /**
   * Creates an analyzer instance based on the specified type
   * @param type - The type of analyzer to create
   * @returns An instance of the requested analyzer
   */
  createAnalyzer(type: AnalyzerType = AnalyzerType.DAFLEX): ITextAnalyzer {
    switch (type) {
      case AnalyzerType.DAFLEX:
        return this.daflexAnalyzer;
      default:
        // Default to DAFlex if unknown type
        console.warn(`Unknown analyzer type: ${type}, defaulting to DAFLEX`);
        return this.daflexAnalyzer;
    }
  }

  /**
   * Gets the default analyzer
   * @returns The default analyzer instance
   */
  getDefaultAnalyzer(): ITextAnalyzer {
    return this.createAnalyzer(AnalyzerType.DAFLEX);
  }
}

