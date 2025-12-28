import {
  ConfidenceEnum,
  GoalEnum,
  CEFREnum,
} from '../Models/user-profile.schema';

export interface PersonalizationProfile {
  cefr: CEFREnum;
  interests: string[];
  goal: GoalEnum;
  confidence: ConfidenceEnum;
}

export interface PersonalizationParams {
  cefr: CEFREnum;
  interests: string[];
  summaryComplexity: 'very simple' | 'simple' | 'normal';
  questionDifficulty: 'basic' | 'moderate' | 'challenging';
  numWords: number;
  numQuestions: number;
  vocabExtras: boolean;
}

export function buildPersonalizationParams(
  profile: PersonalizationProfile,
): PersonalizationParams {
  // Derive session config from confidence level
  const sessionConfig: Record<
    ConfidenceEnum,
    { numWords: number; numQuestions: number }
  > = {
    low: { numWords: 5, numQuestions: 3 },
    medium: { numWords: 7, numQuestions: 4 },
    high: { numWords: 10, numQuestions: 5 },
  };

  const confidenceConfig: Record<
    ConfidenceEnum,
    { summaryComplexity: PersonalizationParams['summaryComplexity']; questionDifficulty: PersonalizationParams['questionDifficulty'] }
  > = {
    low: { summaryComplexity: 'very simple', questionDifficulty: 'basic' },
    medium: { summaryComplexity: 'simple', questionDifficulty: 'moderate' },
    high: {
      summaryComplexity: 'normal',
      questionDifficulty: 'challenging',
    },
  };

  const session = sessionConfig[profile.confidence];
  const confidence = confidenceConfig[profile.confidence];

  return {
    cefr: profile.cefr,
    interests: profile.interests,
    summaryComplexity: confidence.summaryComplexity,
    questionDifficulty: confidence.questionDifficulty,
    numWords: session.numWords,
    numQuestions: session.numQuestions,
    vocabExtras: profile.goal === 'vocabulary',
  };
}

export function generateScaffoldPrompt(
  articleText: string,
  params: PersonalizationParams,
  originalUrl: string = '',
): string {
  const linkSection = originalUrl || 'use provided content link';
  return `
You are a concise German learning assistant.

USER PROFILE:
CEFR: ${params.cefr}
Interests: ${params.interests.join(', ') || 'unspecified'}
Summary complexity: ${params.summaryComplexity}
Question difficulty: ${params.questionDifficulty}
Vocabulary count: ${params.numWords}
Question count: ${params.numQuestions}
Vocab extras: ${params.vocabExtras}

ARTICLE CONTENT:
${articleText}

TASK:
Generate a VERY SHORT personalized scaffold with this FIXED structure:

1. Title
2. Simplified Summary (must be ${params.summaryComplexity}, max 3–5 sentences)
3. Vocabulary (${params.numWords} items, definitions appropriate for ${params.cefr})
4. Questions (${params.numQuestions} items, difficulty: ${params.questionDifficulty})
5. Bonus fact (related to ${params.interests.join(', ') || 'learner interests'} if possible)
6. Link to original content (${linkSection})

Output MUST be concise and minimal.
Never exceed the required counts.
Never add explanations.
`.trim();
}

