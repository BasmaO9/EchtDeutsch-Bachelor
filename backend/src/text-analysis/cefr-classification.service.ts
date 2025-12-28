import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import OpenAI from 'openai';

export interface CefrClassificationResult {
  cefr_level: string;
}

/**
 * Service for classifying German text by CEFR level using OpenAI
 */
@Injectable()
export class CefrClassificationService {
  private openai: OpenAI;

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      console.warn('OPENAI_API_KEY environment variable is not set. CEFR classification will not work.');
    } else {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }
  }

  /**
   * Classifies German text by CEFR level (A1, A2, B1, B2, C1, C2)
   * @param text - German text to classify
   * @returns Promise resolving to CEFR level (A1, A2, B1, B2, C1, or C2)
   */
  async classifyText(text: string): Promise<string> {
    if (!text || text.trim().length === 0) {
      throw new HttpException(
        'Text cannot be empty',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!this.openai) {
      throw new HttpException(
        'OpenAI API key is not configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      const prompt = `You are a German language CEFR level classifier. Analyze the following German text and determine its CEFR level.

CEFR Levels:
- A1: Beginner - Very basic phrases, simple vocabulary, present tense only
- A2: Elementary - Simple sentences, basic grammar, common vocabulary
- B1: Intermediate - Can handle most everyday situations, more complex grammar
- B2: Upper Intermediate - Can understand complex texts, fluent in most situations
- C1: Advanced - Can understand demanding texts, express ideas fluently
- C2: Proficient - Near-native level, understands virtually everything

Return ONLY the CEFR level as a single string: A1, A2, B1, B2, C1, or C2. Do not include any explanation, commentary, or additional text.

German text to classify:
${text}`;

      const completion = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a CEFR level classifier. Return ONLY the CEFR level (A1, A2, B1, B2, C1, or C2) with no additional text.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.0, // Deterministic output
        max_tokens: 10, // Only need the level name
      });

      const rawOutput = (completion.choices[0]?.message?.content || '').trim().toUpperCase();
      
      // Extract CEFR level (should be A1, A2, B1, B2, C1, or C2)
      const cefrLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
      const matchedLevel = cefrLevels.find(level => rawOutput.includes(level));
      
      if (!matchedLevel) {
        // Fallback: try to extract any CEFR-like pattern
        const cefrPattern = /([ABC][12])/i;
        const match = rawOutput.match(cefrPattern);
        if (match) {
          return match[1].toUpperCase();
        }
        
        throw new HttpException(
          `Invalid CEFR level returned: ${rawOutput}. Expected one of: A1, A2, B1, B2, C1, C2`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      return matchedLevel;
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      console.error('Error classifying text by CEFR level:', error);
      throw new HttpException(
        `Failed to classify text: ${error.message || 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Classifies an array of German words by CEFR level
   * @param words - Array of words with their part of speech
   * @returns Promise resolving to array of words with their CEFR levels
   */
  async classifyWords(
    words: Array<{ word: string; pos: 'noun' | 'verb' | 'adjective' }>
  ): Promise<Array<{ word: string; pos: string; cefr: string }>> {
    if (!words || words.length === 0) {
      throw new HttpException(
        'Words array cannot be empty',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!this.openai) {
      throw new HttpException(
        'OpenAI API key is not configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      const prompt = `You are a German linguistics assistant specialized in CEFR classification.

Task:

Classify German words into their most appropriate CEFR level (A1, A2, B1, B2, C1, C2).

Input:

- You will receive a list of German words.
- Each word will be labeled with its part of speech: noun, verb, or adjective.

Rules:

1. Assign ONE CEFR level per word.
2. Base your decision on:
   - Frequency in everyday German
   - Typical learner exposure at each CEFR level
   - Usage in standard language learning curricula (e.g. Goethe, TELC, CEFR-aligned textbooks)
3. Do NOT guess higher levels if the word is commonly taught earlier.
4. If a word spans multiple levels, choose the EARLIEST level where it is reliably taught.
5. Do NOT invent levels or explanations.
6. Do NOT output words not present in the input.

Output format (JSON object with "classified" array):

{
  "classified": [
    {
      "word": "<word>",
      "pos": "<noun|verb|adjective>",
      "cefr": "<A1|A2|B1|B2|C1|C2>"
    }
  ]
}

Example:

Input:
[
  {"word": "gehen", "pos": "verb"},
  {"word": "nachhaltig", "pos": "adjective"}
]

Output:
{
  "classified": [
    {"word": "gehen", "pos": "verb", "cefr": "A1"},
    {"word": "nachhaltig", "pos": "adjective", "cefr": "B2"}
  ]
}

Return ONLY valid JSON object.

Words to classify:
${JSON.stringify(words, null, 2)}`;

      const completion = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a CEFR level classifier. Return ONLY valid JSON object with a "classified" array containing word classifications.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.0, // Deterministic output
      });

      const rawOutput = (completion.choices[0]?.message?.content || '').trim();
      let cleanedOutput = rawOutput;
      if (rawOutput.includes('```json')) {
        cleanedOutput = rawOutput.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      } else if (rawOutput.includes('```')) {
        cleanedOutput = rawOutput.replace(/```\n?/g, '').trim();
      }

      const parsed = JSON.parse(cleanedOutput);
      
      // Handle both array format and object with array property
      let classifiedWords: Array<{ word: string; pos: string; cefr: string }> = [];
      
      if (Array.isArray(parsed)) {
        classifiedWords = parsed;
      } else if (parsed.words && Array.isArray(parsed.words)) {
        classifiedWords = parsed.words;
      } else if (parsed.classified && Array.isArray(parsed.classified)) {
        classifiedWords = parsed.classified;
      } else {
        throw new HttpException(
          'Invalid response format from OpenAI. Expected array of classified words.',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Validate CEFR levels
      const validCefrLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
      const invalidWords = classifiedWords.filter(
        (item) => !item.word || !item.cefr || !validCefrLevels.includes(item.cefr.toUpperCase())
      );

      if (invalidWords.length > 0) {
        console.warn('Some words have invalid CEFR levels:', invalidWords);
        // Filter out invalid entries
        classifiedWords = classifiedWords.filter(
          (item) => item.word && item.cefr && validCefrLevels.includes(item.cefr.toUpperCase())
        );
      }

      // Normalize CEFR levels to uppercase
      classifiedWords = classifiedWords.map((item) => ({
        ...item,
        cefr: item.cefr.toUpperCase(),
      }));

      console.log(`Classified ${classifiedWords.length} words into CEFR levels`);
      return classifiedWords;
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      console.error('Error classifying words by CEFR level:', error);
      throw new HttpException(
        `Failed to classify words: ${error.message || 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

