import { authService } from './auth';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

// Helper function to get headers with auth
const getHeaders = (includeAuth = true): HeadersInit => {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (includeAuth) {
    const authHeader = authService.getAuthHeader();
    return { ...headers, ...authHeader };
  }
  return headers;
};

export interface MediaItem {
  _id: string;
  title: string;
  type: 'video' | 'podcast' | 'article';
  sourceUrl: string;
  transcript?: string;
  cefr: string;
  topic: string;
  imageUrl?: string;
  userId?: string;
  visibility: 'global' | 'private';
  createdAt?: string;
  updatedAt?: string;
}

export interface PersonalizationSummary {
  de: string;
  en: string;
}

export interface VocabularyItem {
  word: string;
  partOfSpeech: string;
  infinitive?: string; // Infinitive form (Grundform) for verbs only
  usageInTranscript: string;
  translation: {
    de: string;
    en: string;
  };
}

export interface FunFact {
  de: string;
  en: string;
}

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

export interface Personalization {
  _id: string;
  mediaId: string;
  summary: string; // JSON string
  vocabulary: string; // JSON string
  funFact: string; // JSON string
  naturalExpressions?: string; // JSON string
  cultureNugget?: string; // JSON string
  personalizableElement?: string; // JSON string
  modelUsed: string;
  userLevel: string;
  userId: string;
  cefrAnalysis?: CEFRAnalysisResult | string; // CEFR analysis results (can be object or JSON string)
}

export interface UserProfilePayload {
  cefr: string;
  interests: string[];
  goal: string;
  confidence: string;
  studyMajor?: string;
}

export const mediaApi = {
  getAll: async (): Promise<MediaItem[]> => {
    const response = await fetch(`${API_BASE_URL}/media`, {
      headers: getHeaders(false), // Media list might be public
    });
    if (!response.ok) {
      throw new Error('Failed to fetch media');
    }
    return response.json();
  },

  getById: async (id: string): Promise<MediaItem> => {
    const response = await fetch(`${API_BASE_URL}/media/${id}`, {
      headers: getHeaders(false), // Media details might be public
    });
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'Failed to fetch media item';
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorMessage;
      } catch {
        errorMessage = response.status === 404 ? 'Media not found' : errorMessage;
      }
      throw new Error(errorMessage);
    }
    return response.json();
  },

  scrapeArticle: async (url: string): Promise<MediaItem> => {
    const response = await fetch(`${API_BASE_URL}/media/scrape`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ url }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'Failed to scrape article/video';
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorMessage;
      } catch {
        errorMessage = errorText || errorMessage;
      }
      throw new Error(errorMessage);
    }
    return response.json();
  },
};

export const personalizationApi = {
  getByMediaId: async (mediaId: string): Promise<Personalization> => {
    const response = await fetch(`${API_BASE_URL}/personalization/${mediaId}`, {
      headers: getHeaders(),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to fetch personalization');
    }
    return response.json();
  },

  generate: async (
    mediaId: string,
    userProfile: { cefr: string; interests: string[]; studyMajor?: string },
    modelProvider: 'openai' | 'groq' | 'gemini' = 'gemini'
  ): Promise<Personalization> => {
    const response = await fetch(`${API_BASE_URL}/personalization/${mediaId}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ ...userProfile, modelProvider }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'Failed to generate personalization';
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorMessage;
      } catch {
        errorMessage = response.status === 404 ? 'Media not found' : errorMessage;
      }
      throw new Error(errorMessage);
    }
    return response.json();
  },

  regenerateSection: async (
    mediaId: string,
    section: 'summary' | 'vocabulary' | 'funFact',
    userProfile: { cefr: string; interests: string[]; studyMajor?: string },
    modelProvider: 'openai' | 'groq' | 'gemini' = 'gemini'
  ): Promise<Personalization> => {
    const response = await fetch(`${API_BASE_URL}/personalization/${mediaId}/regenerate/${section}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ ...userProfile, modelProvider }),
    });
    if (!response.ok) {
      throw new Error(`Failed to regenerate ${section}`);
    }
    return response.json();
  },
};

export const userProfileApi = {
  getProfile: async () => {
    const response = await fetch(`${API_BASE_URL}/user/profile`, {
      headers: getHeaders(),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to fetch profile');
    }
    return response.json();
  },
  saveProfile: async (payload: Omit<UserProfilePayload, 'userId'>) => {
    const response = await fetch(`${API_BASE_URL}/user/profile`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to save profile');
    }
    return response.json();
  },
};

export const quizApi = {
  send: async (
    mediaId: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  ): Promise<{ message: string }> => {
    const response = await fetch(`${API_BASE_URL}/personalization/${mediaId}/quiz`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ history }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to generate quiz turn');
    }
    return response.json();
  },
};

export const ttsApi = {
  speak: async (text: string): Promise<Blob> => {
    const response = await fetch(`${API_BASE_URL}/tts/speak`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to generate speech');
    }
    return response.blob();
  },
};

export interface Evaluation {
  _id: string;
  mediaId: string;
  personalizationId: string;
  evaluationData: string; // JSON string
  userId: string;
  isGenerated: boolean;
}

export const evaluationApi = {
  getByMediaId: async (mediaId: string, personalizationId?: string): Promise<Evaluation> => {
    const url = new URL(`${API_BASE_URL}/personalization/${mediaId}/evaluation`);
    if (personalizationId) {
      url.searchParams.set('personalizationId', personalizationId);
    }
    const response = await fetch(url.toString(), {
      headers: getHeaders(),
    });
    if (!response.ok) {
      if (response.status === 404) {
        // Evaluation not found yet - this is expected during generation
        throw new Error('Evaluation not found');
      }
      const text = await response.text();
      throw new Error(text || 'Failed to fetch evaluation');
    }
    return response.json();
  },

  generate: async (
    mediaId: string,
    personalizationId: string,
    userProfile: { cefr: string; interests?: string[]; studyMajor?: string }
  ): Promise<Evaluation> => {
    const response = await fetch(`${API_BASE_URL}/personalization/${mediaId}/evaluation`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        personalizationId,
        cefr: userProfile.cefr,
        interests: userProfile.interests || [],
        studyMajor: userProfile.studyMajor,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to generate evaluation');
    }
    return response.json();
  },
};

export interface Result {
  _id: string;
  evaluationId: string;
  personalizationId: string;
  userId: string;
  questionsAnsweredCorrectly: number[];
  questionsAnsweredWrong: number[];
  finalScore: number;
  createdAt?: string;
  updatedAt?: string;
}

export const resultsApi = {
  create: async (
    evaluationId: string,
    personalizationId: string,
    questionsAnsweredCorrectly: number[],
    questionsAnsweredWrong: number[],
    finalScore: number
  ): Promise<Result> => {
    const response = await fetch(`${API_BASE_URL}/results`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        evaluationId,
        personalizationId,
        questionsAnsweredCorrectly,
        questionsAnsweredWrong,
        finalScore,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to save results');
    }
    return response.json();
  },

  getByEvaluationId: async (evaluationId: string): Promise<Result | null> => {
    const response = await fetch(`${API_BASE_URL}/results/evaluation/${evaluationId}`, {
      headers: getHeaders(),
    });
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const text = await response.text();
      throw new Error(text || 'Failed to fetch results');
    }
    return response.json();
  },

  getMyResults: async (): Promise<Result[]> => {
    const response = await fetch(`${API_BASE_URL}/results/my-results`, {
      headers: getHeaders(),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to fetch results');
    }
    return response.json();
  },
};

export interface ReportPayload {
  userId: string;
  userName: string;
  currentMediaId: string;
  mediaLink: string;
  reportMessage: string;
  evaluationId?: string;
}

export const reportsApi = {
  submitReport: async (payload: ReportPayload) => {
    const response = await fetch(`${API_BASE_URL}/reports`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Failed to submit report');
    }
    return response.json();
  },
};

