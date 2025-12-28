import { Injectable, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class CefrAnalysisService {
  private openai: OpenAI;

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async analyzeLexicalDifficulty(germanText: string): Promise<{
    A1: { percentage: number; words: string[] };
    A2: { percentage: number; words: string[] };
    B1: { percentage: number; words: string[] };
    B2: { percentage: number; words: string[] };
    C1: { percentage: number; words: string[] };
    C2: { percentage: number; words: string[] };
    unknown: string[];
  }> {
    if (!germanText || germanText.trim() === '') {
      throw new BadRequestException('German text is required and cannot be empty');
    }

    const systemPrompt = `You are a CEFR lexical difficulty analyzer for German language learning.

Your task is to classify each word in a German text according to the minimum CEFR level a learner needs to reliably understand that word (A1, A2, B1, B2, C1, C2).

Your output must always follow these rules:

**Classification Rules**

Classify each unique word's lemma into one CEFR level.

"Belonging to a CEFR level" means:
the earliest level at which a typical learner can understand the word in context.

Consider:
- frequency and commonness
- word transparency & cognateness
- abstractness
- morphology complexity
- idiomaticity
- typical CEFR vocabulary lists

If uncertain → choose the higher level (avoid false "easy" labels).

**Output Rules**

Output ONLY valid JSON.

Include:
- percentage of words at each CEFR level
- an array of the words belonging to that level
- the list of unknown/unclassified words

Preserve lowercase lemmas.

Exclude:
- punctuation
- numbers
- proper names`;

    const userPrompt = `Analyze the following German text for lexical difficulty based on CEFR levels.

For each CEFR level (A1–C2), compute:

"percentage" → % of all classified running words that belong to this level

"words" → array of unique words whose earliest acquisition level is this CEFR level

Also return an array of "unknown" words that you could not classify confidently.

Respond ONLY in JSON using the structure below (no markdown, no code blocks, no additional text):

{
  "A1": { "percentage": 0, "words": [] },
  "A2": { "percentage": 0, "words": [] },
  "B1": { "percentage": 0, "words": [] },
  "B2": { "percentage": 0, "words": [] },
  "C1": { "percentage": 0, "words": [] },
  "C2": { "percentage": 0, "words": [] },
  "unknown": []
}

**German text to analyze:**
${germanText}`;

    try {
      const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const response = await this.openai.chat.completions.create({
        model: modelName,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      });

      const rawOutput = (response.choices[0]?.message?.content || '').trim();

      // Clean up the output in case there's markdown code blocks
      let cleanedOutput = rawOutput;
      if (rawOutput.includes('```json')) {
        cleanedOutput = rawOutput.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      } else if (rawOutput.includes('```')) {
        cleanedOutput = rawOutput.replace(/```\n?/g, '').trim();
      }

      // Try to extract JSON if it's embedded in text
      const jsonMatch = cleanedOutput.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanedOutput = jsonMatch[0];
      }

      let parsed;
      try {
        parsed = JSON.parse(cleanedOutput);
      } catch (err) {
        console.error('Failed to parse LLM output:', cleanedOutput);
        throw new InternalServerErrorException(
          'Failed to parse LLM output. Response was:\n' + cleanedOutput.substring(0, 500)
        );
      }

      // Validate structure
      const requiredLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
      const missingLevels = requiredLevels.filter(level => !parsed[level]);
      if (missingLevels.length > 0) {
        console.error('Invalid LLM output structure:', parsed);
        throw new InternalServerErrorException(
          'Invalid LLM output structure. Missing required CEFR levels: ' + missingLevels.join(', ')
        );
      }

      // Ensure unknown array exists
      if (!parsed.unknown) {
        parsed.unknown = [];
      }

      // Validate each level has percentage and words
      for (const level of requiredLevels) {
        if (!parsed[level].hasOwnProperty('percentage') || !parsed[level].hasOwnProperty('words')) {
          throw new InternalServerErrorException(
            `Invalid structure for ${level}: must have 'percentage' and 'words' properties`
          );
        }
        // Ensure words is an array
        if (!Array.isArray(parsed[level].words)) {
          parsed[level].words = [];
        }
        // Ensure percentage is a number
        if (typeof parsed[level].percentage !== 'number') {
          parsed[level].percentage = 0;
        }
      }

      // Ensure unknown is an array
      if (!Array.isArray(parsed.unknown)) {
        parsed.unknown = [];
      }

      return parsed;
    } catch (error) {
      if (error instanceof InternalServerErrorException || error instanceof BadRequestException) {
        throw error;
      }
      console.error('Error analyzing lexical difficulty:', error);
      throw new InternalServerErrorException(
        'Failed to analyze lexical difficulty: ' + error.message
      );
    }
  }
}

