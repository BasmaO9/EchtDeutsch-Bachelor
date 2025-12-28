import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ITextAnalyzer, CEFRAnalysisResult } from './text-analysis.interface';
import axios, { AxiosError } from 'axios';

/**
 * DAFlex analyzer implementation
 * Analyzes German text using the DAFlex API from UCLouvain
 */
@Injectable()
export class DaflexAnalyzerService implements ITextAnalyzer {
  private readonly DAFLEX_URL = 'https://cental.uclouvain.be/cefrlex/daflex/analyse/';
  private readonly TIMEOUT = 60000; // 60 seconds

  async analyzeText(text: string): Promise<CEFRAnalysisResult> {
    if (!text || text.trim().length === 0) {
      throw new HttpException('Text cannot be empty', HttpStatus.BAD_REQUEST);
    }

    console.log('Sending text to DAFlex...');
    
    const payload = {
      user_text: text,
      resource: 'DAFlex',
      tagger: 'TreeTagger - German',
      version: 'First observation',
    };

    const headers = {
      'User-Agent': 'Mozilla/5.0',
      'Content-Type': 'application/json',
    };

    try {
      const response = await axios.post(this.DAFLEX_URL, payload, {
        headers,
        timeout: this.TIMEOUT,
      });

      if (response.status !== 200) {
        throw new HttpException(
          `DAFlex API returned status ${response.status}`,
          HttpStatus.BAD_GATEWAY,
        );
      }

      const data = response.data;

      if (!Array.isArray(data)) {
        console.error('Unexpected response format from DAFlex:', typeof data);
        throw new HttpException(
          'Unexpected response format from DAFlex API',
          HttpStatus.BAD_GATEWAY,
        );
      }

      // Extract CEFR levels from response
      const levels: string[] = [];
      for (const item of data) {
        const cefr = item?.cefr || 'UNKNOWN';
        levels.push(cefr);
      }

      const total = levels.length;
      
      // Count occurrences of each level
      const counts = {
        A1: 0,
        A2: 0,
        B1: 0,
        B2: 0,
        C1: 0,
        C2: 0,
        UNKNOWN: 0,
        IGNORED: 0,
      };

      for (const level of levels) {
        const upperLevel = level.toUpperCase();
        if (upperLevel in counts) {
          counts[upperLevel as keyof typeof counts]++;
        } else {
          counts.UNKNOWN++;
        }
      }

      // Calculate percentages
      const percentages = {
        A1: total > 0 ? (counts.A1 / total) * 100 : 0,
        A2: total > 0 ? (counts.A2 / total) * 100 : 0,
        B1: total > 0 ? (counts.B1 / total) * 100 : 0,
        B2: total > 0 ? (counts.B2 / total) * 100 : 0,
        C1: total > 0 ? (counts.C1 / total) * 100 : 0,
        C2: total > 0 ? (counts.C2 / total) * 100 : 0,
        UNKNOWN: total > 0 ? (counts.UNKNOWN / total) * 100 : 0,
        IGNORED: total > 0 ? (counts.IGNORED / total) * 100 : 0,
      };

      console.log(`\nTokens processed: ${total}\n`);
      console.log('CEFR Level Distribution:');
      console.log('Level      Count      Percentage');
      console.log('-'.repeat(32));
      for (const level of ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'UNKNOWN', 'IGNORED'] as const) {
        console.log(
          `${level.padEnd(10)}${counts[level].toString().padEnd(10)}${percentages[level].toFixed(2)}%`,
        );
      }

      return {
        total,
        counts,
        percentages,
      };
    } catch (error) {
      if (error instanceof AxiosError) {
        if (error.response) {
          console.error('DAFlex API Error:', error.response.status, error.response.data);
          throw new HttpException(
            `DAFlex API error: ${error.response.status}`,
            HttpStatus.BAD_GATEWAY,
          );
        } else if (error.request) {
          console.error('DAFlex API Timeout or Network Error');
          throw new HttpException(
            'DAFlex API timeout or network error',
            HttpStatus.GATEWAY_TIMEOUT,
          );
        }
      }

      if (error instanceof HttpException) {
        throw error;
      }

      console.error('Unexpected error in DAFlex analyzer:', error);
      throw new HttpException(
        'Failed to analyze text with DAFlex',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

