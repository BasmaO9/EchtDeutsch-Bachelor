import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Personalization } from 'src/Models/personalization.schema';
import { Media } from 'src/Models/media.schema';
import { Evaluation } from 'src/Models/evaluation.schema';
import { UserProfile } from 'src/Models/user-profile.schema';
import { Progress } from 'src/Models/progress.schema';
import OpenAI from 'openai';
import { TextAnalysisService } from '../text-analysis/text-analysis.service';
import { CEFRAnalysisResult } from '../text-analysis/text-analysis.interface';
import { SpacyPosService } from '../text-analysis/spacy-pos.service';
import axios from 'axios';

@Injectable()
export class PersonalizationService {
  private openai: OpenAI;

  constructor(
    @InjectModel(Personalization.name) private personalizationModel: Model<Personalization>,
    @InjectModel(Media.name) private mediaModel: Model<Media>,
    @InjectModel(Evaluation.name) private evaluationModel: Model<Evaluation>,
    @InjectModel(UserProfile.name) private userProfileModel: Model<UserProfile>,
    @InjectModel(Progress.name) private progressModel: Model<Progress>,
    private readonly textAnalysisService: TextAnalysisService,
    private readonly spacyPosService: SpacyPosService,
  ) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async createPersonalization(
    mediaId: string,
    userProfile: {
      cefr: string;
      interests: string[];
      studyMajor?: string;
      userId: string;
    },
    modelProvider: 'openai' | 'groq' | 'gemini' = 'gemini',
  ): Promise<Personalization> {
    const media = await this.mediaModel.findById(mediaId);
    if (!media) throw new NotFoundException('Media not found');
    if (!media.transcript) throw new NotFoundException('Media transcript is required');

    // Always generate new personalization - keep old ones for history
    const objectId = new Types.ObjectId(mediaId);

    // Analyze transcript for CEFR level distribution
    let cefrAnalysis: CEFRAnalysisResult | null = null;
    try {
      console.log('Analyzing transcript with DAFlex...');
      cefrAnalysis = await this.textAnalysisService.analyzeText(media.transcript);
      console.log('CEFR analysis completed:', cefrAnalysis);
    } catch (error) {
      console.warn('Failed to analyze transcript with DAFlex:', error);
      // Continue with scaffold generation even if analysis fails
    }

    try {
      // Use OpenAI for scaffold generation
      if (!this.openai) {
        throw new InternalServerErrorException('OpenAI API key is not configured. Please set OPENAI_API_KEY environment variable.');
      }

      const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';

      // Split generation into two parts:
      // 1. Deterministic (temperature 0.0) for vocabulary and natural expressions
      // 2. Creative (temperature 0.7) for summary, funFact, cultureNugget, personalizableElement

      // Part 1: Deterministic generation for vocabulary and natural expressions
      // Ensure transcript is not truncated - log transcript info for debugging
      const transcriptLength = media.transcript.length;
      const transcriptWordCount = media.transcript.split(/\s+/).filter(w => w.trim().length > 0).length;
      console.log(`Transcript info: ${transcriptWordCount} words, ${transcriptLength} characters - passing FULL transcript to model`);
      
      const deterministicPrompt = this.buildDeterministicScaffoldPrompt(
        media.transcript,
        userProfile.cefr,
        userProfile.interests,
        userProfile.studyMajor,
      );

      const deterministicCompletion = await this.openai.chat.completions.create({
        model: modelName,
        messages: [
          {
            role: 'system',
            content:
              'You are a precise German language extraction assistant. Extract vocabulary and natural expressions EXACTLY as they appear in the transcript. Always respond with valid JSON only, no additional text.',
          },
          {
            role: 'user',
            content: deterministicPrompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.0, // Deterministic - no creativity for vocabulary/extractions
        top_p: 1.0,
        max_tokens: 4000, // Increased to ensure enough space for all vocabulary items
      });

      const deterministicRawOutput = (deterministicCompletion.choices[0]?.message?.content || '').trim();
      let deterministicCleaned = deterministicRawOutput;
      if (deterministicRawOutput.includes('```json')) {
        deterministicCleaned = deterministicRawOutput.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      } else if (deterministicRawOutput.includes('```')) {
        deterministicCleaned = deterministicRawOutput.replace(/```\n?/g, '').trim();
      }

      let deterministicParsed;
      try {
        deterministicParsed = JSON.parse(deterministicCleaned);
      } catch (err) {
        console.error('Failed to parse deterministic LLM output:', deterministicCleaned);
        throw new InternalServerErrorException('Failed to parse deterministic LLM output. Response was:\n' + deterministicCleaned.substring(0, 500));
      }

      // Validate and filter vocabulary and natural expressions against transcript
      const validatedResults = await this.validateAndFilterExtractions(
        deterministicParsed,
        media.transcript,
        userProfile.cefr,
      );
      
      // Ensure we have the required counts
      const nounCount = validatedResults.vocabulary.filter(v => v.partOfSpeech?.toLowerCase() === 'noun').length;
      const verbCount = validatedResults.vocabulary.filter(v => v.partOfSpeech?.toLowerCase() === 'verb').length;
      const adjCount = validatedResults.vocabulary.filter(v => v.partOfSpeech?.toLowerCase() === 'adjective').length;
      
      if (nounCount < 3 || verbCount < 3 || adjCount < 3) {
        console.warn(`Insufficient validated vocabulary: ${nounCount} nouns, ${verbCount} verbs, ${adjCount} adjectives`);
        // Log what we have for debugging
        console.log('Validated vocabulary:', JSON.stringify(validatedResults.vocabulary, null, 2));
      }
      
      deterministicParsed = validatedResults;

      // Part 2: Creative generation for summary, funFact, cultureNugget, personalizableElement
      const creativePrompt = this.buildCreativeScaffoldPrompt(
        media.transcript,
        userProfile.cefr,
        userProfile.interests,
        userProfile.studyMajor,
      );

      const creativeCompletion = await this.openai.chat.completions.create({
        model: modelName,
        messages: [
          {
            role: 'system',
            content:
              'You are a creative German language teaching assistant. Create engaging summaries, fun facts, and personalized content based on the transcript. Always respond with valid JSON only, no additional text.',
          },
          {
            role: 'user',
            content: creativePrompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7, // Creative for engaging content
      });

      const creativeRawOutput = (creativeCompletion.choices[0]?.message?.content || '').trim();
      let creativeCleaned = creativeRawOutput;
      if (creativeRawOutput.includes('```json')) {
        creativeCleaned = creativeRawOutput.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      } else if (creativeRawOutput.includes('```')) {
        creativeCleaned = creativeRawOutput.replace(/```\n?/g, '').trim();
      }

      let creativeParsed;
      try {
        creativeParsed = JSON.parse(creativeCleaned);
      } catch (err) {
        console.error('Failed to parse creative LLM output:', creativeCleaned);
        throw new InternalServerErrorException('Failed to parse creative LLM output. Response was:\n' + creativeCleaned.substring(0, 500));
      }

      // Combine results from both generations
      const parsed = {
        vocabulary: deterministicParsed.vocabulary || [],
        naturalExpressions: deterministicParsed.naturalExpressions || [],
        summary: creativeParsed.summary || { de: '', en: '' },
        funFact: creativeParsed.funFact || { de: '', en: '' },
        cultureNugget: creativeParsed.cultureNugget || { de: '', en: '' },
        personalizableElement: creativeParsed.personalizableElement || { de: '', en: '' },
      };

      // Validate structure
      const requiredFields = ['summary', 'vocabulary', 'funFact', 'naturalExpressions', 'cultureNugget', 'personalizableElement'];
      const missingFields = requiredFields.filter(field => !parsed[field]);
      if (missingFields.length > 0) {
        console.error('Invalid combined LLM output structure:', parsed);
        throw new InternalServerErrorException('Invalid LLM output structure. Missing required fields: ' + missingFields.join(', '));
      }

      // Save to DB
      const personalization = new this.personalizationModel({
        mediaId: objectId,
        summary: JSON.stringify(parsed.summary),
        vocabulary: JSON.stringify(parsed.vocabulary),
        funFact: JSON.stringify(parsed.funFact),
        naturalExpressions: JSON.stringify(parsed.naturalExpressions),
        cultureNugget: JSON.stringify(parsed.cultureNugget),
        personalizableElement: JSON.stringify(parsed.personalizableElement),
        modelUsed: modelName,
        userLevel: userProfile.cefr,
        userId: new Types.ObjectId(userProfile.userId),
        cefrAnalysis: cefrAnalysis ? JSON.stringify(cefrAnalysis) : undefined,
      });

      await personalization.save();

      // Auto-generate evaluation in the background (don't await)
      const personalizationId = (personalization._id as Types.ObjectId).toString();
      this.generateEvaluation(mediaId, personalizationId, userProfile).catch((err) => {
        console.error('Failed to auto-generate evaluation:', err);
        // Don't throw - evaluation generation failure shouldn't break scaffold generation
      });

      // Add analysis results to the returned object
      const personalizationObj = personalization.toObject() as any;
      if (cefrAnalysis) {
        personalizationObj.cefrAnalysis = cefrAnalysis;
      }

      return personalizationObj as Personalization;
    } catch (error) {
      console.error('LLM Error:', error);
      if (error instanceof InternalServerErrorException || error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage = error?.message || 'Unknown error';
      throw new InternalServerErrorException(`Error generating personalization: ${errorMessage}`);
    }
  }

  /**
   * Determines the correct German article (der/die/das) for a noun
   * Uses common German noun endings and patterns
   */
  private determineGermanArticle(noun: string): string {
    const nounLower = noun.toLowerCase().trim();
    
    // Remove existing articles if present
    const nounWithoutArticle = nounLower.replace(/^(der|die|das|ein|eine|mein|dein|sein|ihr|unser|euer)\s+/i, '').trim();
    
    // Common patterns for "die" (feminine)
    const dieEndings = ['ung', 'heit', 'keit', 'schaft', 'tion', 'sion', 'ur', 'ik', 'enz', 'anz', 'age', 'ade', 'e', 'ei'];
    for (const ending of dieEndings) {
      if (nounWithoutArticle.endsWith(ending)) {
        return 'die';
      }
    }
    
    // Common patterns for "das" (neuter)
    const dasEndings = ['chen', 'lein', 'ment', 'um', 'tum', 'nis', 'sal', 'sel'];
    for (const ending of dasEndings) {
      if (nounWithoutArticle.endsWith(ending)) {
        return 'das';
      }
    }
    
    // Common patterns for "der" (masculine)
    const derEndings = ['er', 'ling', 'ig', 'ich', 'ismus', 'or', 'eur', 'ant', 'ent'];
    for (const ending of derEndings) {
      if (nounWithoutArticle.endsWith(ending)) {
        return 'der';
      }
    }
    
    // Default to "der" (most common masculine)
    return 'der';
  }

  /**
   * Fallback extraction: Directly searches transcript for nouns, verbs, and adjectives
   * Used when model fails to extract sufficient words
   */
  private fallbackExtractVocabulary(
    transcript: string,
    cefr: string,
    existingNouns: any[],
    existingVerbs: any[],
    existingAdjectives: any[],
  ): { nouns: any[]; verbs: any[]; adjectives: any[] } {
    const transcriptSentences = transcript.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
    const normalizedTranscript = transcript.toLowerCase();
    const words = transcript.split(/\s+/).filter(w => w.trim().length > 0);
    
    const foundNouns: any[] = [];
    const foundVerbs: any[] = [];
    const foundAdjectives: any[] = [];
    
    // Common German verb patterns (conjugated forms)
    const verbPatterns = /\b(ist|sind|war|waren|hat|haben|hatte|hatten|wird|werden|wurde|wurden|geht|gehen|ging|gingen|macht|machen|machte|machten|kommt|kommen|kam|kamen|sieht|sehen|sah|sahen|weiß|wissen|wusste|wussten|kann|können|konnte|konnten|muss|müssen|musste|mussten|soll|sollen|sollte|sollten|will|wollen|wollte|wollten|darf|dürfen|durfte|durften|gibt|geben|gab|gaben|nimmt|nehmen|nahm|nahmen|findet|finden|fand|fanden|bleibt|bleiben|blieb|blieben|steht|stehen|stand|standen|liegt|liegen|lag|lagen|sitzt|sitzen|saß|saßen|spricht|sprechen|sprach|sprachen|sagt|sagen|sagte|sagten|denkt|denken|dachte|dachten|weiß|wissen|wusste|wussten|fühlt|fühlen|fühlte|fühlten|möchte|möchten|mag|mögen|mochte|mochten)\b/gi;
    
    // Common German adjective endings
    const adjectiveEndings = /(lich|ig|isch|bar|sam|los|voll|arm|reich|frei|fähig|würdig|wert|gemäß|mäßig|artig|weise)$/i;
    
    // Common German noun patterns (capitalized words, often with articles)
    const nounPatterns = /\b(der|die|das|ein|eine|mein|dein|sein|ihr|unser|euer)\s+([A-ZÄÖÜ][a-zäöüß]+)/gi;
    
    // Extract nouns from transcript
    for (const sentence of transcriptSentences) {
      // Find nouns with articles
      let match;
      const nounRegex = /\b(der|die|das|ein|eine|mein|dein|sein|ihr|unser|euer)\s+([A-ZÄÖÜ][a-zäöüß]+)/gi;
      while ((match = nounRegex.exec(sentence)) !== null && foundNouns.length < 10) {
        const article = match[1].toLowerCase();
        const noun = match[2];
        const fullWord = `${article} ${noun}`;
        
        // Check if already exists
        const exists = foundNouns.some(n => n.word.toLowerCase() === fullWord.toLowerCase()) ||
                      existingNouns.some(n => n.word.toLowerCase() === fullWord.toLowerCase());
        
        if (!exists) {
          foundNouns.push({
            word: `${article} ${noun}`,
            partOfSpeech: 'noun',
            usageInTranscript: sentence,
            translation: { de: '', en: '' },
          });
        }
      }
      
      // Find capitalized words that might be nouns (without articles)
      const wordsInSentence = sentence.split(/\s+/);
      for (const word of wordsInSentence) {
        const cleanedWord = word.replace(/[.,!?;:()\[\]{}"]/g, '');
        if (cleanedWord.length > 2 && /^[A-ZÄÖÜ][a-zäöüß]+$/.test(cleanedWord) && foundNouns.length < 10) {
          // Check if it's not a verb or common word
          if (!verbPatterns.test(cleanedWord.toLowerCase()) && 
              !['Ich', 'Sie', 'Er', 'Es', 'Wir', 'Ihr', 'Sie'].includes(cleanedWord)) {
            const article = this.determineGermanArticle(cleanedWord);
            const fullWord = `${article} ${cleanedWord}`;
            
            const exists = foundNouns.some(n => n.word.toLowerCase() === fullWord.toLowerCase()) ||
                          existingNouns.some(n => n.word.toLowerCase() === fullWord.toLowerCase());
            
            if (!exists) {
              foundNouns.push({
                word: fullWord,
                partOfSpeech: 'noun',
                usageInTranscript: sentence,
                translation: { de: '', en: '' },
              });
            }
          }
        }
      }
    }
    
    // Extract verbs from transcript
    for (const sentence of transcriptSentences) {
      const wordsInSentence = sentence.split(/\s+/);
      for (const word of wordsInSentence) {
        const cleanedWord = word.replace(/[.,!?;:()\[\]{}"]/g, '').toLowerCase();
        
        // Check if it matches verb patterns
        if (verbPatterns.test(cleanedWord) && foundVerbs.length < 10) {
          const exists = foundVerbs.some(v => v.word.toLowerCase() === cleanedWord) ||
                        existingVerbs.some(v => v.word.toLowerCase() === cleanedWord);
          
          if (!exists) {
            // Try to determine infinitive (simplified)
            let infinitive = cleanedWord;
            const infinitiveMap: { [key: string]: string } = {
              'ist': 'sein', 'sind': 'sein', 'war': 'sein', 'waren': 'sein',
              'hat': 'haben', 'haben': 'haben', 'hatte': 'haben', 'hatten': 'haben',
              'wird': 'werden', 'werden': 'werden', 'wurde': 'werden', 'wurden': 'werden',
              'geht': 'gehen', 'gehen': 'gehen', 'ging': 'gehen', 'gingen': 'gehen',
              'macht': 'machen', 'machen': 'machen', 'machte': 'machen', 'machten': 'machen',
              'kommt': 'kommen', 'kommen': 'kommen', 'kam': 'kommen', 'kamen': 'kommen',
              'sieht': 'sehen', 'sehen': 'sehen', 'sah': 'sehen', 'sahen': 'sehen',
              'kann': 'können', 'können': 'können', 'konnte': 'können', 'konnten': 'können',
              'muss': 'müssen', 'müssen': 'müssen', 'musste': 'müssen', 'mussten': 'müssen',
              'soll': 'sollen', 'sollen': 'sollen', 'sollte': 'sollen', 'sollten': 'sollen',
              'will': 'wollen', 'wollen': 'wollen', 'wollte': 'wollen', 'wollten': 'wollen',
              'darf': 'dürfen', 'dürfen': 'dürfen', 'durfte': 'dürfen', 'durften': 'dürfen',
              'gibt': 'geben', 'geben': 'geben', 'gab': 'geben', 'gaben': 'geben',
              'nimmt': 'nehmen', 'nehmen': 'nehmen', 'nahm': 'nehmen', 'nahmen': 'nehmen',
              'findet': 'finden', 'finden': 'finden', 'fand': 'finden', 'fanden': 'finden',
              'bleibt': 'bleiben', 'bleiben': 'bleiben', 'blieb': 'bleiben', 'blieben': 'bleiben',
              'steht': 'stehen', 'stehen': 'stehen', 'stand': 'stehen', 'standen': 'stehen',
              'liegt': 'liegen', 'liegen': 'liegen', 'lag': 'liegen', 'lagen': 'liegen',
              'sitzt': 'sitzen', 'sitzen': 'sitzen', 'saß': 'sitzen', 'saßen': 'sitzen',
              'spricht': 'sprechen', 'sprechen': 'sprechen', 'sprach': 'sprechen', 'sprachen': 'sprechen',
              'sagt': 'sagen', 'sagen': 'sagen', 'sagte': 'sagen', 'sagten': 'sagen',
              'denkt': 'denken', 'denken': 'denken', 'dachte': 'denken', 'dachten': 'denken',
              'weiß': 'wissen', 'wissen': 'wissen', 'wusste': 'wissen', 'wussten': 'wissen',
              'fühlt': 'fühlen', 'fühlen': 'fühlen', 'fühlte': 'fühlen', 'fühlten': 'fühlen',
              'möchte': 'mögen', 'mögen': 'mögen', 'mochte': 'mögen', 'mochten': 'mögen',
            };
            
            if (infinitiveMap[cleanedWord]) {
              infinitive = infinitiveMap[cleanedWord];
            } else if (cleanedWord.endsWith('t') && !cleanedWord.endsWith('et')) {
              infinitive = cleanedWord.slice(0, -1) + 'en';
            } else if (cleanedWord.endsWith('en')) {
              infinitive = cleanedWord;
            } else {
              infinitive = cleanedWord + 'en';
            }
            
            foundVerbs.push({
              word: word.replace(/[.,!?;:()\[\]{}"]/g, ''),
              partOfSpeech: 'verb',
              infinitive: infinitive,
              usageInTranscript: sentence,
              translation: { de: '', en: '' },
            });
          }
        }
      }
    }
    
    // Extract adjectives from transcript
    for (const sentence of transcriptSentences) {
      const wordsInSentence = sentence.split(/\s+/);
      for (const word of wordsInSentence) {
        const cleanedWord = word.replace(/[.,!?;:()\[\]{}"]/g, '');
        
        // Check for adjective endings
        if (adjectiveEndings.test(cleanedWord) && foundAdjectives.length < 10) {
          const exists = foundAdjectives.some(a => a.word.toLowerCase() === cleanedWord.toLowerCase()) ||
                        existingAdjectives.some(a => a.word.toLowerCase() === cleanedWord.toLowerCase());
          
          if (!exists && cleanedWord.length > 3) {
            foundAdjectives.push({
              word: cleanedWord,
              partOfSpeech: 'adjective',
              usageInTranscript: sentence,
              translation: { de: '', en: '' },
            });
          }
        }
        
        // Also check for common German adjectives
        const commonAdjectives = ['gut', 'schlecht', 'groß', 'klein', 'neu', 'alt', 'jung', 'alt', 'lang', 'kurz', 'hoch', 'niedrig', 'schnell', 'langsam', 'leicht', 'schwer', 'wichtig', 'wichtig', 'interessant', 'schön', 'hässlich', 'teuer', 'billig', 'frei', 'besetzt', 'offen', 'geschlossen', 'richtig', 'falsch', 'wahr', 'falsch', 'klar', 'unklar', 'sicher', 'unsicher', 'möglich', 'unmöglich', 'nötig', 'unnötig'];
        if (commonAdjectives.includes(cleanedWord.toLowerCase()) && foundAdjectives.length < 10) {
          const exists = foundAdjectives.some(a => a.word.toLowerCase() === cleanedWord.toLowerCase()) ||
                        existingAdjectives.some(a => a.word.toLowerCase() === cleanedWord.toLowerCase());
          
          if (!exists) {
            foundAdjectives.push({
              word: cleanedWord,
              partOfSpeech: 'adjective',
              usageInTranscript: sentence,
              translation: { de: '', en: '' },
            });
          }
        }
      }
    }
    
    return {
      nouns: foundNouns.slice(0, 10),
      verbs: foundVerbs.slice(0, 10),
      adjectives: foundAdjectives.slice(0, 10),
    };
  }

  /**
   * Validates and filters vocabulary and natural expressions to ensure they come from transcript
   */
  private async validateAndFilterExtractions(
    parsed: any,
    transcript: string,
    cefr: string,
  ): Promise<{ vocabulary: any[]; naturalExpressions: any[] }> {
    const normalizedTranscript = transcript.toLowerCase().replace(/\s+/g, ' ');
    const transcriptSentences = transcript.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
    
    // Validate vocabulary
    const nouns: any[] = [];
    const verbs: any[] = [];
    const adjectives: any[] = [];

    if (parsed.vocabulary && Array.isArray(parsed.vocabulary)) {
      for (const item of parsed.vocabulary) {
        if (!item.word || !item.partOfSpeech || !item.usageInTranscript) {
          console.warn('Skipping vocabulary item missing required fields:', item);
          continue;
        }

        // Normalize the word (remove article for checking)
        const wordToCheck = item.word.toLowerCase().trim();
        const wordWithoutArticle = wordToCheck.replace(/^(der|die|das|ein|eine|mein|dein|sein|ihr|unser|euer)\s+/i, '').trim();
        
        // Check if word exists in transcript (with or without article)
        const wordInTranscript = normalizedTranscript.includes(wordToCheck) || 
                                 normalizedTranscript.includes(wordWithoutArticle) ||
                                 normalizedTranscript.includes(item.word.toLowerCase().trim());
        
        if (!wordInTranscript) {
          console.warn(`Vocabulary word "${item.word}" not found in transcript, skipping`);
          continue;
        }

        // Validate usageInTranscript is an exact sentence from transcript
        const usageNormalized = item.usageInTranscript.trim();
        let foundSentence = false;
        let exactSentence = '';
        
        for (const sentence of transcriptSentences) {
          const sentenceNormalized = sentence.toLowerCase().trim();
          const usageNormalizedLower = usageNormalized.toLowerCase().trim();
          
          // Check if usageInTranscript matches a sentence (exact or contains)
          if (sentenceNormalized === usageNormalizedLower || 
              sentenceNormalized.includes(usageNormalizedLower) ||
              usageNormalizedLower.includes(sentenceNormalized)) {
            foundSentence = true;
            exactSentence = sentence; // Use original case from transcript
            break;
          }
        }
        
        if (!foundSentence) {
          console.warn(`Usage sentence "${usageNormalized}" not found in transcript, skipping`);
          continue;
        }

        // Update usageInTranscript to exact sentence from transcript
        item.usageInTranscript = exactSentence;

        // Categorize by part of speech and ensure nouns have articles
        const partOfSpeech = item.partOfSpeech.toLowerCase();
        if (partOfSpeech === 'noun') {
          // Ensure noun has correct article
          const wordLower = item.word.toLowerCase().trim();
          const hasArticle = /^(der|die|das|ein|eine|mein|dein|sein|ihr|unser|euer)\s+/i.test(wordLower);
          
          if (!hasArticle) {
            // Determine article and add it
            const article = this.determineGermanArticle(item.word);
            const nounWithoutArticle = wordLower.replace(/^(der|die|das|ein|eine|mein|dein|sein|ihr|unser|euer)\s+/i, '').trim();
            // Preserve original capitalization of noun
            const nounCapitalized = nounWithoutArticle.charAt(0).toUpperCase() + nounWithoutArticle.slice(1);
            item.word = `${article} ${nounCapitalized}`;
          } else {
            // Verify article is correct, fix if needed
            const articleMatch = wordLower.match(/^(der|die|das|ein|eine|mein|dein|sein|ihr|unser|euer)\s+/i);
            if (articleMatch) {
              const currentArticle = articleMatch[1].toLowerCase();
              const correctArticle = this.determineGermanArticle(item.word);
              // Only fix if it's a definite article (der/die/das)
              if (['der', 'die', 'das'].includes(currentArticle) && currentArticle !== correctArticle) {
                const nounWithoutArticle = wordLower.replace(/^(der|die|das|ein|eine|mein|dein|sein|ihr|unser|euer)\s+/i, '').trim();
                const nounCapitalized = nounWithoutArticle.charAt(0).toUpperCase() + nounWithoutArticle.slice(1);
                item.word = `${correctArticle} ${nounCapitalized}`;
              }
            }
          }
          nouns.push(item);
        } else if (partOfSpeech === 'verb') {
          verbs.push(item);
        } else if (partOfSpeech === 'adjective') {
          adjectives.push(item);
        }
      }
    }

    // Ensure exactly 3 nouns, 3 verbs, 3 adjectives - use fallback if insufficient
    const finalVocabulary: any[] = [];
    
    // Use fallback extraction if we don't have enough words
    if (nouns.length < 3 || verbs.length < 3 || adjectives.length < 3) {
      console.warn(`Insufficient vocabulary from model: ${nouns.length} nouns, ${verbs.length} verbs, ${adjectives.length} adjectives. Using fallback extraction.`);
      
      const fallbackResults = this.fallbackExtractVocabulary(
        transcript,
        cefr,
        nouns,
        verbs,
        adjectives,
      );
      
      // Add fallback nouns if needed
      while (nouns.length < 3 && fallbackResults.nouns.length > 0) {
        const fallbackNoun = fallbackResults.nouns.shift();
        if (fallbackNoun) {
          // Ensure noun has correct article
          const wordLower = fallbackNoun.word.toLowerCase().trim();
          const hasArticle = /^(der|die|das|ein|eine|mein|dein|sein|ihr|unser|euer)\s+/i.test(wordLower);
          if (!hasArticle) {
            const article = this.determineGermanArticle(fallbackNoun.word);
            const nounWithoutArticle = wordLower.replace(/^(der|die|das|ein|eine|mein|dein|sein|ihr|unser|euer)\s+/i, '').trim();
            const nounCapitalized = nounWithoutArticle.charAt(0).toUpperCase() + nounWithoutArticle.slice(1);
            fallbackNoun.word = `${article} ${nounCapitalized}`;
          }
          nouns.push(fallbackNoun);
        }
      }
      
      // Add fallback verbs if needed
      while (verbs.length < 3 && fallbackResults.verbs.length > 0) {
        const fallbackVerb = fallbackResults.verbs.shift();
        if (fallbackVerb) {
          verbs.push(fallbackVerb);
        }
      }
      
      // Add fallback adjectives if needed
      while (adjectives.length < 3 && fallbackResults.adjectives.length > 0) {
        const fallbackAdj = fallbackResults.adjectives.shift();
        if (fallbackAdj) {
          adjectives.push(fallbackAdj);
        }
      }
    }
    
    // Log final counts
    if (nouns.length < 3) {
      console.warn(`Only found ${nouns.length} valid nouns after fallback, need 3.`);
    }
    if (verbs.length < 3) {
      console.warn(`Only found ${verbs.length} valid verbs after fallback, need 3.`);
    }
    if (adjectives.length < 3) {
      console.warn(`Only found ${adjectives.length} valid adjectives after fallback, need 3.`);
    }
    
    // Take exactly 3 of each (or as many as available)
    finalVocabulary.push(...nouns.slice(0, 3));
    finalVocabulary.push(...verbs.slice(0, 3));
    finalVocabulary.push(...adjectives.slice(0, 3));

    // Validate natural expressions
    const validNaturalExpressions: any[] = [];
    if (parsed.naturalExpressions && Array.isArray(parsed.naturalExpressions)) {
      for (const expr of parsed.naturalExpressions) {
        if (!expr.expression || !expr.usageInTranscript) {
          console.warn('Skipping natural expression missing required fields:', expr);
          continue;
        }

        // Check if expression exists in transcript
        const exprNormalized = expr.expression.toLowerCase().trim();
        const exprInTranscript = normalizedTranscript.includes(exprNormalized);
        
        if (!exprInTranscript) {
          console.warn(`Natural expression "${expr.expression}" not found in transcript, skipping`);
          continue;
        }

        // Validate usageInTranscript is an exact sentence from transcript
        const usageNormalized = expr.usageInTranscript.trim();
        let foundSentence = false;
        let exactSentence = '';
        
        for (const sentence of transcriptSentences) {
          const sentenceNormalized = sentence.toLowerCase().trim();
          const usageNormalizedLower = usageNormalized.toLowerCase().trim();
          
          if (sentenceNormalized === usageNormalizedLower || 
              sentenceNormalized.includes(usageNormalizedLower) ||
              usageNormalizedLower.includes(sentenceNormalized)) {
            foundSentence = true;
            exactSentence = sentence;
            break;
          }
        }
        
        if (!foundSentence) {
          console.warn(`Natural expression usage "${usageNormalized}" not found in transcript, skipping`);
          continue;
        }

        expr.usageInTranscript = exactSentence;
        validNaturalExpressions.push(expr);
      }
    }

    // Log validation results
    console.log(`Vocabulary validation: ${finalVocabulary.length} valid items (${nouns.slice(0, 3).length} nouns, ${verbs.slice(0, 3).length} verbs, ${adjectives.slice(0, 3).length} adjectives)`);
    console.log(`Natural expressions validation: ${validNaturalExpressions.length} valid expressions`);

    // Check for missing translations and generate them
    const itemsNeedingTranslation = finalVocabulary.filter(item => 
      !item.translation || 
      !item.translation.de || 
      !item.translation.en || 
      item.translation.de.trim() === '' || 
      item.translation.en.trim() === ''
    );

    if (itemsNeedingTranslation.length > 0) {
      console.log(`Found ${itemsNeedingTranslation.length} vocabulary items with missing translations, generating translations...`);
      await this.generateTranslationsForVocabulary(itemsNeedingTranslation, cefr);
    }

    return {
      vocabulary: finalVocabulary,
      naturalExpressions: validNaturalExpressions,
    };
  }

  /**
   * Generates translations for vocabulary items that are missing them
   */
  private async generateTranslationsForVocabulary(
    vocabularyItems: any[],
    cefr: string,
  ): Promise<void> {
    if (vocabularyItems.length === 0) return;

    const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    
    // Build prompt with words needing translations
    const wordsToTranslate = vocabularyItems.map(item => {
      const wordInfo: any = {
        word: item.word,
        partOfSpeech: item.partOfSpeech,
      };
      if (item.infinitive) {
        wordInfo.infinitive = item.infinitive;
      }
      if (item.usageInTranscript) {
        wordInfo.usageInTranscript = item.usageInTranscript;
      }
      return wordInfo;
    });

    const translationPrompt = `
You are a German-English translation assistant. Translate the following German vocabulary words.

CEFR Level: ${cefr}

For each word, provide:
1. A German explanation/definition (de) - brief, appropriate for ${cefr} level
2. An English translation (en) - direct translation, just the English equivalent word

Vocabulary words to translate:
${JSON.stringify(wordsToTranslate, null, 2)}

Return ONLY valid JSON in this format:
{
  "translations": [
    {
      "word": "exact word from input",
      "translation": {
        "de": "German explanation/definition",
        "en": "English translation"
      }
    }
  ]
}

Ensure every word has both "de" and "en" translations. Do not leave any empty.
`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: modelName,
        messages: [
          {
            role: 'system',
            content: 'You are a German-English translation assistant. Always respond with valid JSON only.',
          },
          {
            role: 'user',
            content: translationPrompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 2000,
      });

      const rawOutput = (completion.choices[0]?.message?.content || '').trim();
      let cleaned = rawOutput;
      if (rawOutput.includes('```json')) {
        cleaned = rawOutput.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      } else if (rawOutput.includes('```')) {
        cleaned = rawOutput.replace(/```\n?/g, '').trim();
      }

      const parsed = JSON.parse(cleaned);
      
      if (parsed.translations && Array.isArray(parsed.translations)) {
        // Create a map for quick lookup
        const translationMap = new Map<string, { de: string; en: string }>();
        for (const trans of parsed.translations) {
          if (trans.word && trans.translation && trans.translation.de && trans.translation.en) {
            translationMap.set(trans.word.toLowerCase().trim(), {
              de: trans.translation.de.trim(),
              en: trans.translation.en.trim(),
            });
          }
        }

        // Update vocabulary items with translations
        for (const item of vocabularyItems) {
          const wordKey = item.word.toLowerCase().trim();
          let translation = translationMap.get(wordKey);
          
          if (!translation) {
            // Try matching without article for nouns
            const wordWithoutArticle = wordKey.replace(/^(der|die|das|ein|eine|mein|dein|sein|ihr|unser|euer)\s+/i, '').trim();
            translation = translationMap.get(wordWithoutArticle);
          }
          
          if (!translation && item.infinitive) {
            // Try matching by infinitive for verbs
            translation = translationMap.get(item.infinitive.toLowerCase().trim());
          }
          
          if (!translation) {
            // Try fuzzy matching - check if any translation key contains the word or vice versa
            for (const [key, value] of translationMap.entries()) {
              const wordWithoutArticle = wordKey.replace(/^(der|die|das|ein|eine|mein|dein|sein|ihr|unser|euer)\s+/i, '').trim();
              if (key.includes(wordWithoutArticle) || wordWithoutArticle.includes(key)) {
                translation = value;
                break;
              }
            }
          }
          
          if (translation && translation.de && translation.en) {
            item.translation = translation;
          } else {
            // Fallback: generate basic translations
            console.warn(`Could not find translation for "${item.word}", using fallback`);
            const wordWithoutArticle = item.word.replace(/^(der|die|das|ein|eine|mein|dein|sein|ihr|unser|euer)\s+/i, '').trim();
            item.translation = {
              de: item.partOfSpeech === 'noun' 
                ? `Ein Substantiv` 
                : item.partOfSpeech === 'verb' 
                  ? `Ein Verb` 
                  : `Ein Adjektiv`,
              en: wordWithoutArticle || item.word,
            };
          }
        }
      }
    } catch (error) {
      console.error('Failed to generate translations:', error);
      // Set fallback translations for all items
      for (const item of vocabularyItems) {
        if (!item.translation || !item.translation.de || !item.translation.en) {
          const wordWithoutArticle = item.word.replace(/^(der|die|das|ein|eine|mein|dein|sein|ihr|unser|euer)\s+/i, '').trim();
          item.translation = {
            de: `Ein ${item.partOfSpeech === 'noun' ? 'Nomen' : item.partOfSpeech === 'verb' ? 'Verb' : 'Adjektiv'}`,
            en: wordWithoutArticle,
          };
        }
      }
    }
  }

  /**
   * Builds prompt for deterministic extraction (vocabulary and natural expressions)
   * Uses temperature 0.0 for precise, factual extraction
   */
  private buildDeterministicScaffoldPrompt(
    transcript: string,
    cefr: string,
    interests: string[],
    studyMajor?: string,
  ): string {
    const vocabCount = 9;
    const interestsList = interests.join(', ');
    const studyMajorText = studyMajor ? ` and study major: ${studyMajor}` : '';
    const transcriptLength = transcript.length;
    const transcriptWordCount = transcript.split(/\s+/).filter(w => w.trim().length > 0).length;

    return `
You are a precise German language extraction assistant. Your task is to EXTRACT vocabulary and natural expressions from the German transcript below. You must be EXACT and FACTUAL - only extract what actually appears in the transcript.

CRITICAL RULES - STRICTLY ENFORCE:
1. ONLY extract words and expressions that EXACTLY appear in the transcript.
2. DO NOT invent, paraphrase, or modify words.
3. DO NOT add information not in the transcript.
4. Preserve exact forms as they appear in transcript.
5. **VERIFICATION REQUIRED**: Before including any word or expression, verify it exists verbatim in the transcript below.
6. **SENTENCE VERIFICATION**: The usageInTranscript field MUST be an EXACT, COMPLETE sentence from the transcript. Copy it character-for-character.
7. **FULL TRANSCRIPT USAGE**: The transcript below is COMPLETE and contains ${transcriptWordCount} words (${transcriptLength} characters). You MUST search through the ENTIRE transcript to find words. DO NOT truncate or skip any part of the transcript.

USER PROFILE:
- CEFR Level: ${cefr}
- Interests: ${interestsList}${studyMajorText}

GERMAN TRANSCRIPT (COMPLETE - ${transcriptWordCount} words, ${transcriptLength} characters - search through ALL of it):
${transcript}

EXTRACTION TASKS:

1. KEY VOCABULARY:
   - Count: EXACTLY ${vocabCount} words total
   - **MANDATORY BREAKDOWN - NO EXCEPTIONS:**
     * EXACTLY 3 nouns (MUST include correct article: der/die/das)
     * EXACTLY 3 verbs (MUST include infinitive form)
     * EXACTLY 3 adjectives
   - **VERIFICATION STEPS FOR EACH WORD:**
     a) Find the word in the transcript (search for it exactly as it appears)
     b) Copy the COMPLETE sentence containing that word from the transcript
     c) Verify the word exists in that sentence
     d) Only then include it in your output
   - Difficulty: Level-appropriate for ${cefr} (A1=very basic, A2=basic, B1=intermediate, B2=advanced)
   - CRITICAL: Select words that are AS LEVEL-SUITABLE AS POSSIBLE for ${cefr}. Prioritize words the user should learn at this level.
   - **For nouns - CRITICAL ARTICLE REQUIREMENT:**
     * EVERY noun MUST have its correct article (der/die/das) in the "word" field
     * If the noun appears WITH an article in the transcript, use that article
     * If the noun appears WITHOUT an article in the transcript, you MUST determine and add the correct article
     * Use German grammar rules to determine gender: 
       - Common feminine endings (-ung, -heit, -keit, -schaft, -tion, -ur, -ik, -enz, -anz) → "die"
       - Common neuter endings (-chen, -lein, -ment, -um, -tum, -nis) → "das"
       - Common masculine endings (-er, -ling, -ig, -ich, -ismus, -or) → "der"
     * Examples: "Haus" (not in transcript with article) → "das Haus", "Frau" → "die Frau", "Mann" → "der Mann"
     * The article is MANDATORY even if the transcript doesn't show it
   - For verbs: 
     * **CRITICAL: The "word" field MUST contain the verb EXACTLY as it appears in the transcript (conjugated form). Do NOT change the form.**
     * If transcript has "geht", word MUST be "geht" (not "gehen" or any other form)
     * If transcript has "ist", word MUST be "ist" (not "sein" or any other form)
     * If transcript has "hat", word MUST be "hat" (not "haben" or any other form)
     * If transcript has "macht", word MUST be "macht" (not "machen" or any other form)
     * **ALWAYS preserve the exact conjugated form from the transcript in the "word" field**
     * MUST include an "infinitive" field with the infinitive form (Grundform) of the verb
     * Example: If transcript has "geht", word="geht" and infinitive="gehen"
     * Example: If transcript has "ist", word="ist" and infinitive="sein"
     * Example: If transcript has "hat gemacht", word="hat gemacht" and infinitive="machen"
   - For adjectives: The word EXACTLY as it appears in the transcript
   - For each word, provide:
     * The word: For nouns, MUST include article (der/die/das) even if not in transcript. For verbs/adjectives, use EXACT form from transcript.
     * Part of speech (must be exactly "noun", "verb", or "adjective")
     * For verbs: infinitive form (Grundform)
     * **usageInTranscript: EXACT, COMPLETE sentence from transcript where this word appears. Copy it character-for-character. Do NOT modify, paraphrase, or shorten it.**
     * German explanation/definition
     * English translation (DIRECT translation of the word, NOT a long explanatory phrase - just the English equivalent word)
   - PERSONALIZATION: Focus vocabulary selection on words related to user interests (${interestsList})${studyMajor ? ` or study major (${studyMajor})` : ''} when possible, BUT prioritize level-appropriateness. If transcript doesn't contain relevant words, select diverse, level-appropriate words anyway.
   - Output format: {"vocabulary": [{"word": "der/die/das Noun (MUST include article) or conjugated verb or adjective", "partOfSpeech": "noun/verb/adjective", "infinitive": "Grundform (ONLY for verbs, omit for nouns/adjectives)", "usageInTranscript": "EXACT COMPLETE SENTENCE FROM TRANSCRIPT", "translation": {"de": "German explanation", "en": "English translation"}}]}
   - **CRITICAL**: Every vocabulary item MUST have a complete "translation" object with BOTH "de" (German explanation) and "en" (English translation) fields. These fields MUST NOT be empty. If you cannot provide a translation, you must still provide a meaningful explanation.
   - **FINAL CHECK - MANDATORY**: Before submitting, you MUST verify you have EXACTLY 3 nouns, 3 verbs, and 3 adjectives. Count them carefully! 
     * If you have fewer than 3 nouns: Search the ENTIRE transcript again for more nouns. They ARE present in the transcript.
     * If you have fewer than 3 verbs: Search the ENTIRE transcript again for more verbs. They ARE present in the transcript.
     * If you have fewer than 3 adjectives: Search the ENTIRE transcript again for more adjectives. They ARE present in the transcript.
     * DO NOT submit until you have EXACTLY 3 of each type. The transcript contains sufficient words - you must find them.

2. NATURAL EXPRESSIONS / SPOKEN FILLERS:
   - **CRITICAL: Extract ONLY natural German expressions that EXACTLY appear in the transcript.**
   - **VERIFICATION REQUIRED**: For each expression, verify it exists verbatim in the transcript before including it.
   - Look for expressions like: "genau", "stimmt", "richtig", "klar", "vielleicht", "irgendwie", "bisschen", "total", "voll", "wirklich", "also", "ähm", "naja", "Alles klar?", "Kein Problem", "Na, wie geht's?", "Oh!", "Ach!", "übrigens", "außerdem", etc.
   - **ONLY include expressions that you can find EXACTLY in the transcript above.**
   - Extract 3-5 natural expressions found. Include single words even if simple. DO NOT skip "common" expressions IF they appear in transcript.
   - For each expression:
     * **expression: EXACT copy from transcript (character-for-character)**
     * **usageInTranscript: EXACT, COMPLETE sentence from transcript where this expression appears. Copy it character-for-character.**
     * German explanation/definition
     * English translation
   - Output: {"naturalExpressions": [{"expression": "EXACT EXPRESSION FROM TRANSCRIPT", "usageInTranscript": "EXACT COMPLETE SENTENCE FROM TRANSCRIPT", "translation": {"de": "German explanation", "en": "English translation"}}]}

**FINAL VERIFICATION CHECKLIST:**
- [ ] Every vocabulary word exists verbatim in the transcript
- [ ] Every usageInTranscript is an exact sentence from the transcript
- [ ] Exactly 3 nouns, 3 verbs, 3 adjectives
- [ ] Every natural expression exists verbatim in the transcript
- [ ] Every natural expression usageInTranscript is an exact sentence from the transcript

Return ONLY valid JSON with "vocabulary" and "naturalExpressions" fields.`;
  }

  /**
   * Builds prompt for creative generation (summary, funFact, cultureNugget, personalizableElement)
   * Uses temperature 0.7 for engaging, creative content
   */
  private buildCreativeScaffoldPrompt(
    transcript: string,
    cefr: string,
    interests: string[],
    studyMajor?: string,
  ): string {
    // Determine summary length and register based on CEFR
    const summaryConfig: Record<string, { length: string; register: string }> = {
      A1: { length: '1 very short sentence', register: 'paraphrased with A1 vocabulary (simple words, basic structures)' },
      A2: { length: '1 very short sentence', register: 'paraphrased with A2 vocabulary (common words, simple structures)' },
      B1: { length: '2 very short sentences', register: 'paraphrased with B1 vocabulary (intermediate words, compound sentences)' },
      B2: { length: '2 very short sentences', register: 'paraphrased with B2 vocabulary (advanced words, complex structures)' },
    };

    const summarySpec = summaryConfig[cefr] || summaryConfig.B1;
    const interestsList = interests.join(', ');
    const studyMajorText = studyMajor ? ` and study major: ${studyMajor}` : '';

    return `
You are a creative German language teaching assistant creating engaging personalized learning materials. Your task is to create summaries, fun facts, and personalized content based on the German transcript below.

CRITICAL RULES:
1. Base content on information in the transcript, but you can be creative in presentation and phrasing.
2. Make content engaging and interesting for learners.
3. All German text must be accurate and grammatically correct.
4. Every German output MUST have an English translation.

USER PROFILE:
- CEFR Level: ${cefr}
- Interests: ${interestsList}${studyMajorText}

GERMAN TRANSCRIPT:
${transcript}

CREATIVE GENERATION TASKS:

1. SUMMARY:
   - Length: ${summarySpec.length}
   - Register: ${summarySpec.register}
   - Must be a small summary of the transcript
   - **CRITICAL: If the transcript is in FIRST PERSON (uses "ich", "mein", "mir", etc.), convert the summary to THIRD PERSON using "The person..." or "Die Person..." in German.**
   - **CRITICAL: Write in THIRD PERSON (use "er/sie/es", "man", "sie" plural, "Die Person", NOT "ich" or "du")**
   - Examples:
     * If transcript says "Ich gehe zur Arbeit" → Summary: "Die Person geht zur Arbeit" or "Er/Sie geht zur Arbeit"
     * If transcript says "Ich habe ein Problem" → Summary: "Die Person hat ein Problem" or "Er/Sie hat ein Problem"
   - Must be PARAPHRASED - do not copy sentences directly from transcript, rephrase them using level-appropriate vocabulary
   - Make it engaging and interesting!
   - Output format: {"summary": {"de": "German summary in third person (use 'Die Person' if transcript was in first person)", "en": "English translation"}}

2. FUN FACT:
   - Must be EITHER:
     a) A fun fact explicitly stated in the transcript, OR
     b) A fun fact ABOUT something mentioned in the transcript (e.g., if transcript mentions Berlin, you can add a fun fact about Berlin)
   - PERSONALIZATION: If possible, relate to user interests (${interestsList})${studyMajor ? ` or study major (${studyMajor})` : ''}. If not possible, use any interesting fact from or about the transcript content.
   - Make it engaging and memorable!
   - Output format: {"funFact": {"de": "German fun fact", "en": "English translation"}}

3. CULTURE NUGGET (Kulturstück):
   - Extract ONE cultural element from the transcript related to:
     * Behavior in Germany
     * Social norms
     * References to cities, food, transportation, healthcare
     * Cultural practices mentioned
   - PERSONALIZATION: If possible, relate to user interests (${interestsList})${studyMajor ? ` or study major (${studyMajor})` : ''}.
   - Make it culturally informative and interesting!
   - Output format: {"cultureNugget": {"de": "German cultural insight", "en": "English translation"}}

4. PERSONALIZABLE ELEMENT:
   - Create ONE personalized learning element that connects the transcript content to the user's profile
   - This should be a unique insight, connection, or learning opportunity
   - **MANDATORY FORMAT**: Start with "Since you are interested in [interest]..." or "Since you study [studyMajor]..." (in German: "Da du dich für [interest] interessierst..." or "Da du [studyMajor] studierst...")
   - Then say: "...this piece of media might be interesting to you because..." (in German: "...könnte dieses Medium für dich interessant sein, weil...")
   - Then provide something smart, relevant, and interesting based on the transcript content. Make it insightful and engaging.
   - PERSONALIZATION: Must relate to user interests (${interestsList})${studyMajor ? ` or study major (${studyMajor})` : ''} AND content from transcript
   - Be creative in making connections!
   - Output format: {"personalizableElement": {"de": "German personalized content following the format above", "en": "English translation"}}

Return ONLY valid JSON with "summary", "funFact", "cultureNugget", and "personalizableElement" fields.`;
  }

  private buildPersonalizedScaffoldPrompt(
    transcript: string,
    cefr: string,
    interests: string[],
    studyMajor?: string,
  ): string {
    // Determine summary length and register based on CEFR
    const summaryConfig: Record<string, { length: string; register: string }> = {
      A1: { length: '1 very short sentence', register: 'paraphrased with A1 vocabulary (simple words, basic structures)' },
      A2: { length: '1 very short sentence', register: 'paraphrased with A2 vocabulary (common words, simple structures)' },
      B1: { length: '2 very short sentences', register: 'paraphrased with B1 vocabulary (intermediate words, compound sentences)' },
      B2: { length: '2 very short sentences', register: 'paraphrased with B2 vocabulary (advanced words, complex structures)' },
    };

    const summarySpec = summaryConfig[cefr] || summaryConfig.B1;
    // Vocabulary: exactly 3 nouns, 3 verbs (with infinitive form), and 3 adjectives = 9 total
    const vocabCount = 9;
    const interestsList = interests.join(', ');
    const studyMajorText = studyMajor ? ` and study major: ${studyMajor}` : '';

    return `
You are an expert German language tutor creating personalized learning materials. Your task is to analyze the German transcript below and create a comprehensive scaffold tailored to the user's profile.

CRITICAL RULES - STRICTLY ENFORCE:
1. ONLY use information that is explicitly mentioned in the transcript. DO NOT add information that is not in the transcript.
2. DO NOT hallucinate or invent facts, numbers, names, or details.
3. If something is not clear in the transcript, state that it's not mentioned rather than guessing.
4. All German text must be accurate and grammatically correct.
5. Every German output MUST have an English translation.

USER PROFILE:
- CEFR Level: ${cefr}
- Interests: ${interestsList}${studyMajorText}

PERSONALIZATION RULES:

1. SUMMARY:
   - Length: ${summarySpec.length}
   - Register: ${summarySpec.register}
   - Must be a small summary of the transcript
   - **CRITICAL: If the transcript is in FIRST PERSON (uses "ich", "mein", "mir", etc.), convert the summary to THIRD PERSON using "The person..." or "Die Person..." in German.**
   - **CRITICAL: Write in THIRD PERSON (use "er/sie/es", "man", "sie" plural, "Die Person", NOT "ich" or "du")**
   - Examples:
     * If transcript says "Ich gehe zur Arbeit" → Summary: "Die Person geht zur Arbeit" or "Er/Sie geht zur Arbeit"
     * If transcript says "Ich habe ein Problem" → Summary: "Die Person hat ein Problem" or "Er/Sie hat ein Problem"
   - Must be PARAPHRASED - do not copy sentences directly from transcript, rephrase them using level-appropriate vocabulary
   - Output format: {"summary": {"de": "German summary in third person (use 'Die Person' if transcript was in first person)", "en": "English translation"}}

2. KEY VOCABULARY:
   - Count: Exactly ${vocabCount} words (3 nouns + 3 verbs + 3 adjectives)
   - **MANDATORY BREAKDOWN:**
     * Exactly 3 nouns (with articles: der/die/das)
     * Exactly 3 verbs (MUST include infinitive form)
     * Exactly 3 adjectives
   - Difficulty: Level-appropriate for ${cefr} (A1=very basic, A2=basic, B1=intermediate, B2=advanced)
   - CRITICAL: Select words that are AS LEVEL-SUITABLE AS POSSIBLE for ${cefr}. Prioritize words the user should learn at this level.
   - For nouns: ALWAYS include the correct article (der/die/das)
   - For verbs: 
     * **CRITICAL: The "word" field MUST contain the verb EXACTLY as it appears in the transcript (conjugated form). Do NOT change the form.**
     * If transcript has "geht", word MUST be "geht" (not "gehen" or any other form)
     * If transcript has "ist", word MUST be "ist" (not "sein" or any other form)
     * If transcript has "hat", word MUST be "hat" (not "haben" or any other form)
     * If transcript has "macht", word MUST be "macht" (not "machen" or any other form)
     * **ALWAYS preserve the exact conjugated form from the transcript in the "word" field**
     * MUST include an "infinitive" field with the infinitive form (Grundform) of the verb
     * Example: If transcript has "geht", word="geht" and infinitive="gehen"
     * Example: If transcript has "ist", word="ist" and infinitive="sein"
     * Example: If transcript has "hat gemacht", word="hat gemacht" and infinitive="machen"
   - For adjectives: The word as it appears in the transcript
   - For each word, provide:
     * The word as it appears in transcript (with article if noun)
     * Part of speech (must be exactly "noun", "verb", or "adjective")
     * For verbs: infinitive form (Grundform)
     * How it was used in the transcript (exact sentence or phrase from transcript - MUST be the complete sentence where the word appears)
     * German explanation/definition
     * English translation (DIRECT translation of the word, NOT a long explanatory phrase - just the English equivalent word)
   - PERSONALIZATION: Focus vocabulary selection on words related to user interests (${interestsList})${studyMajor ? ` or study major (${studyMajor})` : ''} when possible, BUT prioritize level-appropriateness. If transcript doesn't contain relevant words, select diverse, level-appropriate words anyway.
   - Output format: {"vocabulary": [{"word": "der/die/das Word or conjugated verb or adjective", "partOfSpeech": "noun/verb/adjective", "infinitive": "Grundform (ONLY for verbs, omit for nouns/adjectives)", "usageInTranscript": "exact sentence from transcript", "translation": {"de": "German explanation", "en": "English translation"}}]}

3. FUN FACT:
   - Must be EITHER:
     a) A fun fact explicitly stated in the transcript, OR
     b) A fun fact ABOUT something mentioned in the transcript (e.g., if transcript mentions Berlin, you can add a fun fact about Berlin)
   - PERSONALIZATION: If possible, relate to user interests (${interestsList})${studyMajor ? ` or study major (${studyMajor})` : ''}. If not possible, use any interesting fact from or about the transcript content.
   - Output format: {"funFact": {"de": "German fun fact", "en": "English translation"}}

4. NATURAL EXPRESSIONS / SPOKEN FILLERS:
   - **CRITICAL: Extract ALL natural German expressions from transcript. MANDATORY - find at least 3-5.**
   - Look for: "genau", "stimmt", "richtig", "klar", "vielleicht", "irgendwie", "bisschen", "total", "voll", "wirklich", "also", "ähm", "naja", "Alles klar?", "Kein Problem", "Na, wie geht's?", "Oh!", "Ach!", "übrigens", "außerdem", etc.
   - Extract EVERY natural expression found. Include single words even if simple. DO NOT skip "common" expressions.
   - For each: expression (exact from transcript), complete sentence where used, German explanation, English translation.
   - Output: {"naturalExpressions": [{"expression": "German expression", "usageInTranscript": "exact complete sentence from transcript", "translation": {"de": "German explanation", "en": "English translation"}}]}

5. CULTURE NUGGET (Kulturstück):
   - Extract ONE cultural element from the transcript related to:
     * Behavior in Germany
     * Social norms
     * References to cities, food, transportation, healthcare
     * A German habit mentioned in passing
     * Any cultural insight about German-speaking countries
   - Must be explicitly mentioned or clearly implied in the transcript
   - Output format: {"cultureNugget": {"de": "German cultural insight", "en": "English translation"}}

6. PERSONALIZABLE ELEMENT:
   - Create a personalized connection between the transcript content and the user's interests (${interestsList})${studyMajor ? ` or study major (${studyMajor})` : ''}.
   - Must be based on content that appears in the transcript
   - **MANDATORY FORMAT**: Start with "Since you are interested in [interest]..." or "Since you study [studyMajor]..." (in German: "Da du dich für [interest] interessierst..." or "Da du [studyMajor] studierst...")
   - Then say: "...this piece of media might be interesting to you because..." (in German: "...könnte dieses Medium für dich interessant sein, weil...")
   - Then provide something smart, relevant, and interesting based on the transcript content (without hallucinating). Make it insightful and engaging.
   - **CRITICAL**: Do NOT repeat content already mentioned in summary, vocabulary, fun fact, culture nugget, or natural expressions. Find a DIFFERENT element from the transcript.
   - **CRITICAL**: Do NOT hallucinate or invent information. Only use facts and content that are explicitly stated in the transcript.
   - Example format (in German): "Da du dich für Technologie interessierst, könnte dieses Medium für dich interessant sein, weil [smart, relevant, and interesting reason from transcript]."
   - Example format (in German): "Da du Informatik studierst, könnte dieses Medium für dich interessant sein, weil [smart, relevant, and interesting reason from transcript]."
   - If transcript doesn't contain anything related to user interests/studyMajor, output empty object: {"personalizableElement": {"de": "", "en": ""}}
   - Must be authentic to the transcript content - NO HALLUCINATION
   - Output format: {"personalizableElement": {"de": "German personalized element following the format above", "en": "English translation"}}

OUTPUT REQUIREMENTS:
- Output everything in **strict JSON** following this exact schema:
{
  "summary": {
    "de": "German summary (${summarySpec.length}, ${summarySpec.register})",
    "en": "English translation"
  },
  "vocabulary": [
    {
      "word": "der/die/das Word (for nouns) or conjugated verb (for verbs) or adjective (for adjectives)",
      "partOfSpeech": "noun/verb/adjective",
      "infinitive": "Grundform (ONLY for verbs, omit this field for nouns and adjectives)",
      "usageInTranscript": "exact sentence or phrase from transcript",
      "translation": {
        "de": "German explanation or definition",
        "en": "English translation"
      }
    }
  ],
  "funFact": {
    "de": "German fun fact from transcript",
    "en": "English translation"
  },
  "naturalExpressions": [
    {
      "expression": "German expression",
      "usageInTranscript": "exact context from transcript",
      "translation": {
        "de": "German explanation",
        "en": "English translation"
      }
    }
  ],
  "cultureNugget": {
    "de": "German cultural insight",
    "en": "English translation"
  },
  "personalizableElement": {
    "de": "German personalized element (or empty if no connection possible)",
    "en": "English translation (or empty if no connection possible)"
  }
}

TRANSCRIPT TO ANALYZE:
${transcript}

Remember: Every German output MUST have an English translation. Personalize based on CEFR level (${cefr}) and user interests (${interestsList})${studyMajor ? ` and study major (${studyMajor})` : ''} when possible, but never hallucinate information not in the transcript.
`.trim();
  }

  async regenerateSection(
    mediaId: string,
    section: 'summary' | 'vocabulary' | 'funFact',
    userProfile: {
      cefr: string;
      interests: string[];
      studyMajor?: string;
      userId: string;
    },
    modelProvider: 'openai' | 'groq' | 'gemini' = 'gemini', // Keep parameter for compatibility but default to gemini
  ): Promise<Personalization> {
    // Regenerate the whole thing to ensure consistency
    return this.createPersonalization(mediaId, userProfile, modelProvider);
  }

  async getByMediaId(mediaId: string, userId: string): Promise<Personalization> {
    let objectId: Types.ObjectId;
    try {
      objectId = new Types.ObjectId(mediaId);
    } catch {
      throw new NotFoundException('Invalid media id');
    }
    const userObjectId = new Types.ObjectId(userId);
    // Get the most recent personalization for this media and user (sorted by createdAt descending)
    const p = await this.personalizationModel
      .findOne({ mediaId: objectId, userId: userObjectId })
      .sort({ createdAt: -1 })
      .exec();
    if (!p) throw new NotFoundException('Personalization not found');
    return p;
  }

  async getAll(): Promise<Personalization[]> {
    return this.personalizationModel.find().populate('mediaId').exec();
  }

  async generateEvaluation(
    mediaId: string,
    personalizationId: string,
    userProfile: {
      cefr: string;
      interests: string[];
      studyMajor?: string;
      userId: string;
    },
  ): Promise<Evaluation> {
    console.log('=== GENERATE EVALUATION CALLED ===');
    console.log('MediaId:', mediaId);
    console.log('PersonalizationId:', personalizationId);
    console.log('UserProfile:', {
      cefr: userProfile.cefr,
      interests: userProfile.interests,
      studyMajor: userProfile.studyMajor,
      userId: userProfile.userId,
    });
    
    let objectId: Types.ObjectId;
    try {
      objectId = new Types.ObjectId(mediaId);
    } catch {
      throw new NotFoundException('Invalid media id');
    }

    console.log('Fetching personalization with ID:', personalizationId);
    const personalization = await this.personalizationModel.findById(personalizationId);
    if (!personalization) {
      console.error('Personalization not found for ID:', personalizationId);
      throw new NotFoundException('Personalization not found');
    }
    
    console.log('Personalization found:', {
      personalizationId: String(personalization._id),
      mediaId: String(personalization.mediaId),
      hasSummary: !!personalization.summary,
      hasVocabulary: !!personalization.vocabulary,
      hasFunFact: !!personalization.funFact,
    });
    
    // IMPORTANT: Always generate a NEW evaluation for this scaffold/personalization.
    // We do NOT reuse existing evaluations so that each scaffold generation
    // gets its own fresh evaluation linked via personalizationId.
    // Delete ANY existing evaluation for this personalization (complete or incomplete)
    // to avoid duplicate key errors when regenerating scaffold.
    const existingEvaluation = await this.evaluationModel.findOne({
      mediaId: objectId,
      personalizationId: new Types.ObjectId(personalizationId),
    });

    if (existingEvaluation) {
      console.log('Deleting existing evaluation for personalizationId:', personalizationId, 'isGenerated:', existingEvaluation.isGenerated);
      await this.evaluationModel.deleteOne({ _id: existingEvaluation._id });
    }

    // Fetch media to get transcript text
    const media = await this.mediaModel.findById(objectId);
    const transcriptText = media?.transcript || '';

    // Build scaffold object from personalization - ensure all fields are properly parsed
    let scaffold: any = {};
    try {
      scaffold = {
        summary: personalization.summary ? JSON.parse(personalization.summary) : { de: '', en: '' },
        vocabulary: personalization.vocabulary ? JSON.parse(personalization.vocabulary) : [],
        funFact: personalization.funFact ? JSON.parse(personalization.funFact) : { de: '', en: '' },
        cultureNugget: personalization.cultureNugget ? JSON.parse(personalization.cultureNugget) : { de: '', en: '' },
        expressions: personalization.naturalExpressions ? JSON.parse(personalization.naturalExpressions) : [],
        personalizableElement: personalization.personalizableElement ? JSON.parse(personalization.personalizableElement) : { de: '', en: '' },
        text: transcriptText, // Full transcript text for source_span references
        usageInTranscript: transcriptText ? transcriptText.split(/[.!?]+/).filter(s => s.trim().length > 0).slice(0, 10) : [], // Sample sentences from transcript
      };
      
      // Validate scaffold has content
      if (!scaffold.vocabulary || scaffold.vocabulary.length === 0) {
        throw new InternalServerErrorException('Scaffold vocabulary is empty. Cannot generate evaluation without vocabulary.');
      }
      if (!scaffold.summary || !scaffold.summary.de) {
        throw new InternalServerErrorException('Scaffold summary is empty. Cannot generate evaluation without summary.');
      }
      
      console.log('=== SCAFFOLD BUILT FOR EVALUATION ===');
      console.log('Personalization ID used:', personalizationId);
      console.log('Personalization _id:', String(personalization._id));
      console.log('MediaId from personalization:', String(personalization.mediaId));
      console.log('Scaffold built successfully:', {
        vocabularyCount: scaffold.vocabulary?.length || 0,
        hasSummary: !!scaffold.summary?.de,
        summaryPreview: scaffold.summary?.de?.substring(0, 100),
        hasFunFact: !!scaffold.funFact?.de,
        hasCultureNugget: !!scaffold.cultureNugget?.de,
        expressionsCount: scaffold.expressions?.length || 0,
        vocabularyWords: scaffold.vocabulary?.slice(0, 3).map((v: any) => v.word),
      });
      console.log('=====================================');
    } catch (err) {
      console.error('Error parsing scaffold:', err);
      throw new InternalServerErrorException('Failed to parse scaffold data. Ensure personalization is complete.');
    }

    // Map user goal to purpose (vocabulary, reading, grammar, general)
    // Get user profile to determine purpose
    let userProfileData: any = null;
    try {
      userProfileData = await this.userProfileModel.findOne({ userId: new Types.ObjectId(userProfile.userId) });
    } catch (err) {
      console.log('Could not fetch user profile for evaluation purpose');
    }
    
    const purposeMap: Record<string, string> = {
      vocabulary: 'vocabulary',
      reading: 'reading',
      grammar: 'grammar',
      general: 'general',
    };
    
    const userGoal = userProfileData?.goal || 'general';
    const purpose = purposeMap[userGoal] || 'general';

    const userProfileForPrompt = {
      cefr: userProfile.cefr,
      purpose: purpose,
      interests: userProfile.interests || [],
      studyMajor: userProfile.studyMajor || '',
    };

    // Generate evaluation in 3 separate calls to keep prompts small and focused
    // Pass previously generated questions to avoid repetition across phases
    console.log('=== CALLING EVALUATION GENERATION METHODS ===');
    console.log('Personalization ID being used:', personalizationId);
    console.log('User Profile Data:', {
      userId: userProfile.userId,
      cefr: userProfile.cefr,
      goalFromDB: userProfileData?.goal,
      mappedPurpose: purpose,
      userProfileForPrompt: userProfileForPrompt,
    });
    console.log('============================================');
    
    // Generate flashcards first (no previous questions to avoid)
    const flashcards = await this.generateFlashcards(scaffold, userProfileForPrompt, personalizationId, []);
    
    // Extract used words/concepts from flashcards to avoid in MCQs
    const usedInFlashcards = this.extractUsedContent(flashcards, 'flashcard');
    
    // Generate MCQs, avoiding content used in flashcards
    const mcqs = await this.generateMCQs(scaffold, userProfileForPrompt, personalizationId, usedInFlashcards);
    
    // Extract used words/concepts from MCQs to avoid in next phase
    const usedInMCQs = this.extractUsedContent(mcqs, 'mcq');
    const allPreviouslyUsed = [...usedInFlashcards, ...usedInMCQs];
    
    // Check if user goal is comprehension - if so, generate short answer questions instead of fill-in-the-blanks
    const normalizedGoal = (userProfileForPrompt.purpose || 'general').toLowerCase().trim();
    const canonicalGoal = ['vocabulary', 'reading', 'grammar', 'general'].includes(normalizedGoal) 
      ? normalizedGoal 
      : 'general';
    const promptGoal = canonicalGoal === 'reading' ? 'comprehension' : canonicalGoal;
    
    let fillInTheBlanks: any[] = [];
    let shortAnswerQuestions: any[] = [];
    
    if (promptGoal === 'comprehension') {
      // Generate short answer questions for comprehension goals
      shortAnswerQuestions = await this.generateShortAnswerQuestions(scaffold, userProfileForPrompt, personalizationId, allPreviouslyUsed);
    } else {
      // Generate fill-in-the-blanks for vocabulary/grammar/general goals
      fillInTheBlanks = await this.generateFillInTheBlanks(scaffold, userProfileForPrompt, personalizationId, allPreviouslyUsed, transcriptText);
    }

    // Combine results
    const parsed: any = {
      flashcards,
      mcqs,
      fillInTheBlanks,
      fill_items: fillInTheBlanks, // Also support new format name
      shortAnswerQuestions,
    };

    try {
      // Validate we have results
      if (!parsed.flashcards || parsed.flashcards.length === 0) {
        throw new InternalServerErrorException('Failed to generate flashcards');
      }
      if (!parsed.mcqs || parsed.mcqs.length === 0) {
        throw new InternalServerErrorException('Failed to generate MCQs');
      }
      // For comprehension goals, check short answer questions; otherwise check fill-in-the-blanks
      if (promptGoal === 'comprehension') {
        if (!parsed.shortAnswerQuestions || parsed.shortAnswerQuestions.length === 0) {
          throw new InternalServerErrorException('Failed to generate short answer questions');
        }
      } else {
        if (!parsed.fillInTheBlanks || parsed.fillInTheBlanks.length === 0) {
          throw new InternalServerErrorException('Failed to generate fill-in-the-blanks');
        }
      }

      console.log('Evaluation generated successfully:', {
        flashcards: parsed.flashcards.length,
        mcqs: parsed.mcqs.length,
        fillInTheBlanks: promptGoal === 'comprehension' ? 0 : parsed.fillInTheBlanks.length,
        shortAnswerQuestions: promptGoal === 'comprehension' ? parsed.shortAnswerQuestions.length : 0,
      });

      // Calculate expected options count based on CEFR level for validation
      const level = (userProfileForPrompt.cefr || 'B1').toUpperCase();
      const cefrBand =
        level.startsWith('A') ? 'A1-A2' :
        level.startsWith('B') ? 'B1-B2' :
        'C1-C2';
      const expectedOptionsCount =
        cefrBand === 'A1-A2' ? 3 :
        cefrBand === 'B1-B2' ? 4 :
        5; // C1-C2

      // Convert to old format for compatibility with frontend
      const converted = {
        metadata: {
          cefr: userProfileForPrompt.cefr,
          purpose: userProfileForPrompt.purpose,
          interests: userProfileForPrompt.interests,
          studyMajor: userProfileForPrompt.studyMajor,
        },
        evaluation: [
          {
            phase: 'flashcard',
            items: parsed.flashcards.map((item: any, index: number) => {
              if (!item.front_de || !item.back_de) {
                console.error(`Invalid flashcard at index ${index}:`, item);
              }
              console.log(`Flashcard ${index + 1}: type="${item.type}", front_de="${item.front_de?.substring(0, 50)}..."`);
              return {
                id: item.id || `flashcard-${index}`,
                prompt_de: item.front_de || '',
                prompt_en_hidden: item.front_en || item.front_de || '',
                type: 'flashcard',
                answer_de: item.back_de || '',
                answer_en_hidden: item.back_en || '',
                expected_answer_de: item.back_de || '',
                expected_answer_en_hidden: item.back_en || '',
                confirm_choices: item.confirm_choices || ['✓', '✕'],
                instructions_de: item.instructions_de || 'Klicke ✓ wenn richtig, ✕ wenn falsch',
                instructions_en: item.instructions_en || 'Tap ✓ if correct, ✕ if incorrect',
                source_span: item.source_span || { start_char: 0, end_char: 0 },
                feedback_if_correct_de: 'Richtig! Sehr gut!',
                feedback_if_correct_en_hidden: 'Correct! Very good!',
                feedback_if_incorrect_de: `Die richtige Antwort ist: ${item.back_de || ''}`,
                feedback_if_incorrect_en_hidden: `The correct answer is: ${item.back_en || ''}`,
              };
            }),
          },
          {
            phase: 'mcq',
            items: parsed.mcqs.map((item: any, index: number) => {
              // Handle new format with choices array or old format with options_de/options_en
              const choices = item.choices || [];
              let options_de = item.options_de || choices.map((c: any) => c.text_de || c);
              let options_en = item.options_en || choices.map((c: any) => c.text_en || c.text_de || c);
              const correctIndex = item.correct_index !== undefined ? item.correct_index : (item.correctAnswerIndex ?? 0);
              const front_de = item.front_de || item.question_de || '';
              const front_en = item.front_en || item.question_en || front_de;

              // For vocabulary MCQs: Extract target word from question and validate
              let context_sentence_de = item.context_sentence_de || '';
              let context_sentence_en_hidden = item.context_sentence_en || item.context_sentence_en_hidden || '';
              
              if (item.type === 'vocabulary' && front_de) {
                // Extract target word from question (e.g., "Welches Wort ist ein Synonym für \"Hund\"?")
                const targetWordMatch = front_de.match(/"([^"]+)"/);
                if (targetWordMatch) {
                  const targetWordOriginal = targetWordMatch[1].trim();
                  const targetWord = targetWordOriginal.toLowerCase();
                  
                  // Helper function to check if a text contains the target word (with word boundaries)
                  const containsTargetWord = (text: string): boolean => {
                    const textLower = text.toLowerCase();
                    // Check for exact word match (with word boundaries)
                    const wordBoundaryRegex = new RegExp(`\\b${targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
                    if (wordBoundaryRegex.test(text)) {
                      return true;
                    }
                    // Also check if it's part of a compound word (German allows compound words)
                    // But be more careful - only if the target word is a complete word within the text
                    const words = textLower.split(/\s+/);
                    return words.some(word => {
                      // Exact match
                      if (word === targetWord) return true;
                      // Check if target word is at the start or end of a compound word
                      // (e.g., "Hund" in "Hundehütte" or "Haushund")
                      return word.startsWith(targetWord) || word.endsWith(targetWord);
                    });
                  };
                  
                  // Remove target word from choices if it appears (more robust filtering)
                  const originalLength = options_de.length;
                  const filteredIndices: number[] = [];
                  options_de = options_de.filter((opt: string, idx: number) => {
                    const optTrimmed = opt.trim();
                    // Check if option contains the target word
                    const isTargetWord = containsTargetWord(optTrimmed);
                    if (!isTargetWord) {
                      filteredIndices.push(idx);
                      return true;
                    }
                    console.warn(`MCQ ${index + 1}: Filtering out choice "${optTrimmed}" because it contains target word "${targetWordOriginal}"`);
                    return false;
                  });
                  
                  // Update options_en to match filtered options_de
                  options_en = options_en.filter((_: any, idx: number) => filteredIndices.includes(idx));
                  
                  // Adjust correct_index if items were removed before it
                  let adjustedCorrectIndex = correctIndex;
                  filteredIndices.forEach((originalIdx, newIdx) => {
                    if (originalIdx === correctIndex) {
                      adjustedCorrectIndex = newIdx;
                    }
                  });
                  
                  if (options_de.length < originalLength) {
                    console.warn(`MCQ ${index + 1}: Removed ${originalLength - options_de.length} choice(s) containing target word "${targetWordOriginal}"`);
                    // If correct answer was removed, we need to handle this - use first option as fallback
                    if (adjustedCorrectIndex >= options_de.length || filteredIndices.length === 0 || !filteredIndices.includes(correctIndex)) {
                      adjustedCorrectIndex = 0;
                      console.error(`MCQ ${index + 1}: Correct answer was the target word. Using first option as fallback.`);
                    }
                  }
                  
                  // Ensure we have the correct number of choices based on CEFR level
                  // Calculate expected count for vocab MCQs
                  const level = (userProfileForPrompt?.cefr || 'B1').toUpperCase();
                  const cefrBand =
                    level.startsWith('A') ? 'A1-A2' :
                    level.startsWith('B') ? 'B1-B2' :
                    'C1-C2';
                  const expectedCount =
                    cefrBand === 'A1-A2' ? 3 :
                    cefrBand === 'B1-B2' ? 4 :
                    5; // C1-C2
                  
                  // If we have fewer choices than expected, add generic distractors
                  if (options_de.length < expectedCount) {
                    const needed = expectedCount - options_de.length;
                    console.warn(`MCQ ${index + 1}: Only ${options_de.length} choices after filtering, need ${expectedCount}. Adding ${needed} generic distractor(s).`);
                    
                    // Generate generic distractors (common German words that are unlikely to be correct)
                    const genericDistractors = [
                      { de: 'verschieden', en: 'different' },
                      { de: 'wichtig', en: 'important' },
                      { de: 'möglich', en: 'possible' },
                      { de: 'schwierig', en: 'difficult' },
                      { de: 'einfach', en: 'simple' },
                      { de: 'neu', en: 'new' },
                      { de: 'alt', en: 'old' },
                      { de: 'groß', en: 'big' },
                      { de: 'klein', en: 'small' },
                      { de: 'gut', en: 'good' },
                    ];
                    
                    // Filter out distractors that might already be in options or match target word
                    const existingOptions = new Set(options_de.map((opt: string) => opt.toLowerCase().trim()));
                    const availableDistractors = genericDistractors.filter(
                      d => !existingOptions.has(d.de.toLowerCase()) && 
                           !containsTargetWord(d.de)
                    );
                    
                    // Add as many as needed
                    for (let i = 0; i < needed && i < availableDistractors.length; i++) {
                      options_de.push(availableDistractors[i].de);
                      options_en.push(availableDistractors[i].en);
                    }
                    
                    // If still not enough, add numbered placeholders
                    while (options_de.length < expectedCount) {
                      const placeholderNum = options_de.length + 1;
                      options_de.push(`Option ${placeholderNum}`);
                      options_en.push(`Option ${placeholderNum}`);
                      console.warn(`MCQ ${index + 1}: Added placeholder option ${placeholderNum} to reach expected count`);
                    }
                  } else if (options_de.length > expectedCount) {
                    // If we have more than expected, trim to expected count (keep correct answer)
                    console.warn(`MCQ ${index + 1}: Has ${options_de.length} choices, expected ${expectedCount}. Trimming excess.`);
                    // Keep the correct answer and trim from the end
                    const correctAnswer = options_de[adjustedCorrectIndex];
                    const correctAnswerEn = options_en[adjustedCorrectIndex];
                    options_de = options_de.slice(0, expectedCount);
                    options_en = options_en.slice(0, expectedCount);
                    // If correct answer was trimmed, put it back at the end
                    if (!options_de.includes(correctAnswer)) {
                      options_de[expectedCount - 1] = correctAnswer;
                      options_en[expectedCount - 1] = correctAnswerEn;
                      adjustedCorrectIndex = expectedCount - 1;
                    } else {
                      // Recalculate correct index
                      adjustedCorrectIndex = options_de.indexOf(correctAnswer);
                    }
                  }
                  
                  // Find or verify context sentence contains the target word
                  if (!context_sentence_de || !containsTargetWord(context_sentence_de)) {
                    // Try to find the sentence containing the target word from scaffold.text
                    if (scaffold?.text) {
                      // Split text into sentences (handle German sentence endings)
                      const sentences = scaffold.text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
                      const foundSentence = sentences.find(s => containsTargetWord(s));
                      
                      if (foundSentence) {
                        context_sentence_de = foundSentence.trim();
                        console.log(`MCQ ${index + 1}: Found correct context sentence containing "${targetWordOriginal}": "${context_sentence_de.substring(0, 80)}..."`);
                      } else {
                        console.warn(`MCQ ${index + 1}: Could not find sentence containing target word "${targetWordOriginal}" in scaffold.text`);
                        // Keep the original context_sentence_de even if it doesn't contain the word
                        // (better than having no sentence at all)
                      }
                    } else {
                      console.warn(`MCQ ${index + 1}: scaffold.text not available to find correct context sentence`);
                    }
                    
                    if (!context_sentence_de) {
                      console.warn(`MCQ ${index + 1}: Missing context_sentence_de for vocabulary MCQ`);
                    } else if (!containsTargetWord(context_sentence_de)) {
                      console.warn(`MCQ ${index + 1}: Context sentence does not contain target word "${targetWordOriginal}". Sentence: "${context_sentence_de.substring(0, 100)}..."`);
                    }
                  } else {
                    // Verify the sentence exists in scaffold.text
                    if (scaffold?.text && !scaffold.text.includes(context_sentence_de)) {
                      console.warn(`MCQ ${index + 1}: Context sentence not found in scaffold.text. May be generated by LLM.`);
                    }
                  }
                  
                  // Ensure context sentence has English translation
                  // If missing, try to find it in scaffold vocabulary or generate a placeholder
                  if (context_sentence_de && !context_sentence_en_hidden) {
                    // Try to find translation from scaffold vocabulary usageInTranscript
                    if (scaffold?.vocabulary) {
                      const vocabItem = scaffold.vocabulary.find((v: any) => 
                        v.usageInTranscript && context_sentence_de.includes(v.word)
                      );
                      if (vocabItem && vocabItem.usageInTranscript) {
                        // Check if usageInTranscript has translation
                        const usage = Array.isArray(vocabItem.usageInTranscript) 
                          ? vocabItem.usageInTranscript[0] 
                          : vocabItem.usageInTranscript;
                        if (usage && typeof usage === 'object' && usage.en) {
                          context_sentence_en_hidden = usage.en;
                        }
                      }
                    }
                    
                    // If still no translation, use a placeholder that indicates translation needed
                    if (!context_sentence_en_hidden) {
                      context_sentence_en_hidden = '[Translation needed]';
                      console.warn(`MCQ ${index + 1}: Missing English translation for context sentence. Using placeholder.`);
                    }
                  }
                  
                  // Update correct_index
                  const finalCorrectIndex = adjustedCorrectIndex;
                  
                  return {
                    id: item.id || `mcq-${index}`,
                    prompt_de: front_de,
                    prompt_en_hidden: front_en,
                    type: 'mcq',
                    options_de: options_de,
                    options_en_hidden: options_en,
                    correct_index: finalCorrectIndex,
                    expected_answer_de: options_de[finalCorrectIndex] || '',
                    expected_answer_en_hidden: options_en[finalCorrectIndex] || '',
                    feedback_if_correct_de: item.explanation_de || 'Richtig! Sehr gut!',
                    feedback_if_correct_en_hidden: item.explanation_en || 'Correct! Very good!',
                    feedback_if_incorrect_de: item.explanation_de || `Die richtige Antwort ist: ${options_de[finalCorrectIndex] || ''}`,
                    feedback_if_incorrect_en_hidden: item.explanation_en || `The correct answer is: ${options_en[finalCorrectIndex] || ''}`,
                    source_span: item.source_span || { start_char: 0, end_char: 0 },
                    context_sentence_de: context_sentence_de,
                    context_sentence_en_hidden: context_sentence_en_hidden,
                  };
                }
              }

              // Validate and fix options count based on CEFR level for all MCQs (non-vocab MCQs)
              let finalCorrectIndex = correctIndex;
              if (item.type !== 'vocabulary') {
                // Calculate expected count based on CEFR level
                const level = (userProfileForPrompt?.cefr || 'B1').toUpperCase();
                const cefrBand =
                  level.startsWith('A') ? 'A1-A2' :
                  level.startsWith('B') ? 'B1-B2' :
                  'C1-C2';
                const expectedCount =
                  cefrBand === 'A1-A2' ? 3 :
                  cefrBand === 'B1-B2' ? 4 :
                  5; // C1-C2
                
                // Ensure we have the correct number of choices
                if (options_de.length !== expectedCount) {
                  console.warn(`MCQ ${index + 1} (type: ${item.type}): Has ${options_de.length} option(s), expected ${expectedCount} for ${cefrBand} level.`);
                  
                  // If we have fewer, add generic distractors
                  if (options_de.length < expectedCount) {
                    const needed = expectedCount - options_de.length;
                    const genericDistractors = [
                      { de: 'verschieden', en: 'different' },
                      { de: 'wichtig', en: 'important' },
                      { de: 'möglich', en: 'possible' },
                      { de: 'schwierig', en: 'difficult' },
                      { de: 'einfach', en: 'simple' },
                      { de: 'neu', en: 'new' },
                      { de: 'alt', en: 'old' },
                      { de: 'groß', en: 'big' },
                      { de: 'klein', en: 'small' },
                      { de: 'gut', en: 'good' },
                    ];
                    
                    const existingOptions = new Set(options_de.map((opt: string) => opt.toLowerCase().trim()));
                    const availableDistractors = genericDistractors.filter(
                      d => !existingOptions.has(d.de.toLowerCase())
                    );
                    
                    for (let i = 0; i < needed && i < availableDistractors.length; i++) {
                      options_de.push(availableDistractors[i].de);
                      options_en.push(availableDistractors[i].en);
                    }
                    
                    // If still not enough, add numbered placeholders
                    while (options_de.length < expectedCount) {
                      const placeholderNum = options_de.length + 1;
                      options_de.push(`Option ${placeholderNum}`);
                      options_en.push(`Option ${placeholderNum}`);
                    }
                  } else if (options_de.length > expectedCount) {
                    // If we have more, trim to expected count (keep correct answer)
                    const correctAnswer = options_de[correctIndex];
                    const correctAnswerEn = options_en[correctIndex];
                    options_de = options_de.slice(0, expectedCount);
                    options_en = options_en.slice(0, expectedCount);
                    // If correct answer was trimmed, put it back
                    if (!options_de.includes(correctAnswer)) {
                      options_de[expectedCount - 1] = correctAnswer;
                      options_en[expectedCount - 1] = correctAnswerEn;
                      finalCorrectIndex = expectedCount - 1;
                    } else {
                      finalCorrectIndex = options_de.indexOf(correctAnswer);
                    }
                  }
                }
              }

              if (!front_de || !options_de || options_de.length === 0 || finalCorrectIndex === undefined) {
                console.error(`Invalid MCQ at index ${index}:`, item);
              }

              console.log(`MCQ ${index + 1}: front_de="${front_de?.substring(0, 50)}...", correct_index=${finalCorrectIndex}`);

              return {
                id: item.id || `mcq-${index}`,
                prompt_de: front_de,
                prompt_en_hidden: front_en,
                type: 'mcq',
                options_de: options_de,
                options_en_hidden: options_en,
                correct_index: finalCorrectIndex,
                expected_answer_de: options_de[finalCorrectIndex] || '',
                expected_answer_en_hidden: options_en[finalCorrectIndex] || '',
                feedback_if_correct_de: item.explanation_de || 'Richtig! Sehr gut!',
                feedback_if_correct_en_hidden: item.explanation_en || 'Correct! Very good!',
                feedback_if_incorrect_de: item.explanation_de || `Die richtige Antwort ist: ${options_de[correctIndex] || ''}`,
                feedback_if_incorrect_en_hidden: item.explanation_en || `The correct answer is: ${options_en[correctIndex] || ''}`,
                source_span: item.source_span || { start_char: 0, end_char: 0 },
                // Context sentence for grammar MCQs (tense questions) and vocabulary MCQs (synonym/antonym)
                context_sentence_de: context_sentence_de,
                context_sentence_en_hidden: context_sentence_en_hidden,
              };
            }),
          },
          {
            phase: promptGoal === 'comprehension' ? 'short_answer' : 'fill',
            items: (() => {
              if (promptGoal === 'comprehension') {
                // Handle short answer questions for comprehension goals
                const shortAnswerItems = parsed.shortAnswerQuestions || [];
                
                return shortAnswerItems.map((item: any, index: number) => {
                  const question_de = item.question_de || '';
                  const question_en = item.question_en || question_de;
                  const model_answer_de = item.model_answer_de || '';
                  const model_answer_en = item.model_answer_en || model_answer_de;
                  
                  if (!question_de || !model_answer_de) {
                    console.error(`Invalid short answer question at index ${index}:`, item);
                  }
                  
                  console.log(`Short answer question ${index + 1}: question_de="${question_de?.substring(0, 50)}...", model_answer_de="${model_answer_de}"`);
                  
                  return {
                    id: item.id || `short-answer-${index}`,
                    prompt_de: question_de,
                    prompt_en_hidden: question_en,
                    type: 'short_answer',
                    model_answer_de: model_answer_de,
                    model_answer_en_hidden: model_answer_en,
                    source_span: item.source_span || { start_char: 0, end_char: 0 },
                  };
                });
              }
              
              // Handle both new format (fill_items) and old format (fillInTheBlanks)
              const fillItems = (parsed as any).fill_items || parsed.fillInTheBlanks || [];
              
              console.log(`\n=== TRANSFORMING FILL-IN-THE-BLANKS ===`);
              console.log(`Total fill items received: ${fillItems.length}`);
              fillItems.forEach((item: any, idx: number) => {
                console.log(`Fill item ${idx + 1}:`, {
                  id: item.id,
                  type: item.type,
                  sentence_de: item.sentence_de?.substring(0, 50) || 'MISSING',
                  question_de: item.question_de?.substring(0, 50) || 'MISSING',
                  has_blank: (item.sentence_de || item.question_de || '').includes('__[1]__'),
                  choices_count: (item.drag_options || item.choices_de || []).length
                });
              });
              
              return fillItems
                .map((item: any, index: number) => {
                // Handle vocabulary format (draggable_options_de) or grammar format (drag_options) or old format (choices_de)
                const dragOptions = item.drag_options || [];
                const draggableOptionsDe = item.draggable_options_de || [];
                const choices_de = item.choices_de || 
                                  (draggableOptionsDe.length > 0 ? draggableOptionsDe : 
                                   dragOptions.map((opt: any) => opt.text_de || opt));
                const draggableOptionsEn = item.draggable_options_en_hidden || [];
                const choices_en = item.choices_en || 
                                 (draggableOptionsEn.length > 0 ? draggableOptionsEn :
                                  dragOptions.map((opt: any) => opt.text_en || opt.text_de || opt));
                
                // Handle new format with correct_indices (array) or old format with correctAnswerIndex (single)
                const correctIndices = item.correct_indices || [];
                const correctIndex = correctIndices.length > 0 ? correctIndices[0] : 
                                   (item.correct_index !== undefined ? item.correct_index : 
                                    (item.correctAnswerIndex ?? 0));
                
                // Handle vocabulary format (blank_sentence_de) or grammar format (sentence_de) or old format (sentenceWithBlank_de)
                // For grammar questions, sentence_de comes from question_de field
                const sentence_de = item.blank_sentence_de || 
                                   item.sentence_de || 
                                   item.question_de || 
                                   item.sentenceWithBlank_de || 
                                   '';
                const sentence_en = item.blank_sentence_en_hidden ||
                                   item.sentence_en || 
                                   item.question_en || 
                                   item.sentenceWithBlank_en || 
                                   sentence_de;
                
                // Handle prompt (vocabulary format has prompt_de, grammar may not)
                const prompt_de = item.prompt_de || sentence_de;
                const prompt_en = item.prompt_en_hidden || item.prompt_en || sentence_en;

                // Validate that correct answers are in the choices
                const missingCorrectAnswers: number[] = [];
                if (correctIndices.length > 0) {
                  correctIndices.forEach((idx: number) => {
                    if (idx < 0 || idx >= choices_de.length) {
                      missingCorrectAnswers.push(idx);
                    } else {
                      // Verify the choice at this index is not empty
                      const choice = choices_de[idx];
                      if (!choice || choice.trim().length === 0) {
                        console.error(`Fill-in-the-blank ${index + 1}: Choice at index ${idx} is empty`);
                        missingCorrectAnswers.push(idx);
                      }
                    }
                  });
                } else if (correctIndex !== undefined && (correctIndex < 0 || correctIndex >= choices_de.length)) {
                  missingCorrectAnswers.push(correctIndex);
                } else if (correctIndex !== undefined && correctIndex >= 0 && correctIndex < choices_de.length) {
                  // Verify the choice at correctIndex is not empty
                  const choice = choices_de[correctIndex];
                  if (!choice || choice.trim().length === 0) {
                    console.error(`Fill-in-the-blank ${index + 1}: Choice at correctIndex ${correctIndex} is empty`);
                    missingCorrectAnswers.push(correctIndex);
                  }
                }
                
                // Variable to track if we need to update correctIndex
                let actualCorrectIndex = correctIndex;
                let actualCorrectIndices = correctIndices.length > 0 ? correctIndices : [correctIndex];
                
                if (missingCorrectAnswers.length > 0) {
                  console.error(`Fill-in-the-blank ${index + 1}: correct_indices point to invalid options. Indices: ${JSON.stringify(missingCorrectAnswers)}, but choices_de has ${choices_de.length} items.`, item);
                  console.error(`Available choices:`, choices_de);
                  
                  // For grammar fill-ins, try to find the correct answer if correct_form is provided
                  if (item.type === 'grammar' && item.correct_form) {
                    // Use case-insensitive, trimmed comparison to find the correct form
                    const normalizeForComparison = (str: string) => str.trim().toLowerCase();
                    const normalizedCorrectForm = normalizeForComparison(item.correct_form);
                    
                    let correctFormIndex = choices_de.findIndex((c: string) => 
                      normalizeForComparison(c) === normalizedCorrectForm
                    );
                    
                    // If not found exactly, try substring match
                    if (correctFormIndex === -1) {
                      correctFormIndex = choices_de.findIndex((c: string) => {
                        const normalized = normalizeForComparison(c);
                        return normalized === normalizedCorrectForm ||
                               normalized.includes(normalizedCorrectForm) ||
                               normalizedCorrectForm.includes(normalized);
                      });
                    }
                    
                    if (correctFormIndex !== -1) {
                      console.warn(`Grammar fill-in ${index + 1}: Found correct_form "${item.correct_form}" at index ${correctFormIndex}. Updating correct_index.`);
                      // Update the choice to use the exact correct form (case-sensitive)
                      choices_de[correctFormIndex] = item.correct_form;
                      // Update correctIndex and correctIndices
                      actualCorrectIndex = correctFormIndex;
                      actualCorrectIndices = [correctFormIndex];
                    } else {
                      console.error(`CRITICAL: correct_form "${item.correct_form}" not found in choices:`, choices_de);
                      // This is a critical error - the item is invalid
                      console.error(`Skipping invalid fill-in-the-blank ${index + 1}`);
                      return null;
                    }
                  } else {
                    // Critical error - cannot fix
                    console.error(`Skipping invalid fill-in-the-blank ${index + 1} due to invalid correct_index`);
                    return null;
                  }
                }

                if (!sentence_de || !choices_de || choices_de.length === 0 || actualCorrectIndex === undefined) {
                  console.error(`Invalid fill-in-the-blank at index ${index}:`, item);
                  return null;
                }

                // Count number of blanks from placeholders
                const placeholderMatches = sentence_de.match(/__\[\d+\]__/g);
                const blankCount = placeholderMatches ? placeholderMatches.length : (sentence_de.split('____').length - 1);

                // Validate blank count matches correct_indices length
                const expectedBlankCount = correctIndices.length > 0 ? correctIndices.length : 1;
                if (blankCount !== expectedBlankCount) {
                  console.warn(`Fill-in-the-blank ${index + 1}: blank count mismatch. Found ${blankCount} placeholder(s) in sentence but correct_indices has ${expectedBlankCount} item(s). Sentence: "${sentence_de?.substring(0, 100)}..."`);
                }

                // Ensure correct_indices matches blank count
                let finalCorrectIndices = actualCorrectIndices;
                if (actualCorrectIndices.length !== blankCount) {
                  if (actualCorrectIndices.length > 0 && blankCount > 0) {
                    // Use first N indices if we have more than needed, or pad if we have fewer
                    finalCorrectIndices = blankCount <= actualCorrectIndices.length 
                      ? actualCorrectIndices.slice(0, blankCount)
                      : [...actualCorrectIndices, ...Array(blankCount - actualCorrectIndices.length).fill(actualCorrectIndices[0] || 0)];
                    console.warn(`Fill-in-the-blank ${index + 1}: Adjusted correct_indices from ${actualCorrectIndices.length} to ${blankCount} to match blank count.`);
                  } else if (blankCount > 0) {
                    // If no correct_indices but we have blanks, use the first option for all
                    finalCorrectIndices = Array(blankCount).fill(actualCorrectIndex);
                  }
                }

                console.log(`Fill-in-the-blank ${index + 1}: sentence_de="${sentence_de?.substring(0, 50)}...", blank_count=${blankCount}, correct_indices=${JSON.stringify(finalCorrectIndices)}`);

              return {
                  id: item.id || `fill-${index}`,
                  prompt_de: prompt_de,
                  prompt_en_hidden: prompt_en,
                type: 'fill',
                  blank_sentence_de: sentence_de,
                  blank_sentence_en_hidden: sentence_en,
                  draggable_options_de: choices_de,
                  draggable_options_en_hidden: choices_en,
                  correct_index: finalCorrectIndices[0] || actualCorrectIndex, // Keep for backward compatibility
                  correct_indices: finalCorrectIndices.length > 0 ? finalCorrectIndices : [actualCorrectIndex], // Array for multiple blanks - length matches blankCount
                  expected_answer_de: choices_de[actualCorrectIndex] || '',
                  expected_answer_en_hidden: choices_en[actualCorrectIndex] || '',
                feedback_if_correct_de: item.explanation_de || 'Richtig! Sehr gut!',
                feedback_if_correct_en_hidden: item.explanation_en || 'Correct! Very good!',
                  feedback_if_incorrect_de: item.explanation_de || `Die richtige Antwort ist: ${finalCorrectIndices.length > 0 ? finalCorrectIndices.map(idx => choices_de[idx]).filter(Boolean).join(', ') : (choices_de[finalCorrectIndices[0] || correctIndex] || '')}`,
                  feedback_if_incorrect_en_hidden: item.explanation_en || `The correct answer is: ${finalCorrectIndices.length > 0 ? finalCorrectIndices.map(idx => choices_en[idx]).filter(Boolean).join(', ') : (choices_en[finalCorrectIndices[0] || correctIndex] || '')}`,
                  source_span: item.source_span || { start_char: 0, end_char: 0 },
                  answer_spans: item.answer_spans || [],
                };
              })
              .filter((item: any) => item !== null); // Remove invalid items
            })(),
          },
        ],
      };

      // Log converted structure for debugging
      console.log('\n=== FINAL EVALUATION STRUCTURE ===');
      console.log('Total phases:', converted.evaluation.length);
      console.log('Flashcards:', converted.evaluation[0]?.items?.length || 0);
      console.log('MCQs:', converted.evaluation[1]?.items?.length || 0);
      console.log('Third phase type:', converted.evaluation[2]?.phase || 'unknown');
      console.log('Third phase items:', converted.evaluation[2]?.items?.length || 0);
      
      // Log details of fill-in-the-blanks if they exist
      if (converted.evaluation[2]?.phase === 'fill' && converted.evaluation[2]?.items) {
        console.log('\n=== FILL-IN-THE-BLANKS DETAILS ===');
        converted.evaluation[2].items.forEach((item: any, idx: number) => {
          console.log(`Fill item ${idx + 1}:`, {
            id: item.id,
            blank_sentence_de: item.blank_sentence_de?.substring(0, 80) || 'MISSING',
            has_blank: (item.blank_sentence_de || '').includes('__[1]__'),
            draggable_options_count: item.draggable_options_de?.length || 0,
            correct_indices: item.correct_indices
          });
        });
      }
      
      // Validate converted structure
      if (converted.evaluation[0]?.items?.length === 0) {
        console.error('No flashcards in converted structure');
      }
      if (converted.evaluation[1]?.items?.length === 0) {
        console.error('No MCQs in converted structure');
      }
      if (converted.evaluation[2]?.items?.length === 0) {
        console.error(`No ${promptGoal === 'comprehension' ? 'short answer questions' : 'fill-in-the-blanks'} in converted structure`);
      }

      // Save evaluation
      const evaluationJsonString = JSON.stringify(converted);
      console.log('Saving evaluation JSON (first 500 chars):', evaluationJsonString.substring(0, 500));
      
      // ALWAYS create a NEW evaluation document for this scaffold/personalization.
      // This ensures each scaffold generation has its own evaluation instance.
      // If a duplicate key error occurs (race condition), delete the existing one and retry.
      let evaluationData;
      try {
        evaluationData = new this.evaluationModel({
          mediaId: objectId,
          personalizationId: new Types.ObjectId(personalizationId),
          evaluationData: evaluationJsonString,
          userId: new Types.ObjectId(userProfile.userId),
          isGenerated: true,
        });
        await evaluationData.save();
      } catch (saveError: any) {
        // Handle duplicate key error (E11000) - can happen in race conditions
        if (saveError.code === 11000 && saveError.keyPattern && saveError.keyPattern.mediaId && saveError.keyPattern.personalizationId) {
          console.log('Duplicate key error detected, deleting existing evaluation and retrying...');
          // Delete the existing evaluation and retry
          await this.evaluationModel.deleteOne({
            mediaId: objectId,
            personalizationId: new Types.ObjectId(personalizationId),
          });
          // Retry creating the evaluation
          evaluationData = new this.evaluationModel({
            mediaId: objectId,
            personalizationId: new Types.ObjectId(personalizationId),
            evaluationData: evaluationJsonString,
            userId: new Types.ObjectId(userProfile.userId),
            isGenerated: true,
          });
          await evaluationData.save();
        } else {
          // Re-throw if it's a different error
          throw saveError;
        }
      }

      // Verify what was saved
      const savedData = JSON.parse(evaluationData.evaluationData);
      console.log('Verification - Saved evaluation structure:', {
        hasEvaluation: !!savedData.evaluation,
        phasesCount: savedData.evaluation?.length || 0,
        phase1Items: savedData.evaluation?.[0]?.items?.length || 0,
        phase2Items: savedData.evaluation?.[1]?.items?.length || 0,
        phase3Items: savedData.evaluation?.[2]?.items?.length || 0,
      });

      console.log('Evaluation generated and saved successfully');
      return evaluationData;
    } catch (error) {
      console.error('Evaluation generation error:', error);
      if (error instanceof InternalServerErrorException || error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage = error?.message || 'Unknown error';
      throw new InternalServerErrorException(`Error generating evaluation: ${errorMessage}`);
    }
  }

  async getEvaluationByMediaId(mediaId: string, personalizationId?: string): Promise<Evaluation | null> {
    let objectId: Types.ObjectId;
    try {
      objectId = new Types.ObjectId(mediaId);
    } catch {
      throw new NotFoundException('Invalid media id');
    }
    
    console.log('getEvaluationByMediaId: Searching for evaluation with mediaId:', mediaId, 'personalizationId:', personalizationId);
    
    // Build query filter
    const query: any = { mediaId: objectId, isGenerated: true };
    
    // If personalizationId is provided, filter by it to get the correct evaluation
    if (personalizationId) {
      try {
        query.personalizationId = new Types.ObjectId(personalizationId);
        console.log('Filtering by personalizationId:', personalizationId);
      } catch {
        console.warn('Invalid personalizationId provided:', personalizationId);
        // Continue without personalizationId filter if invalid
      }
    }
    
    // Get the most recent evaluation by sorting by createdAt descending
    const evaluation = await this.evaluationModel
      .findOne(query)
      .sort({ createdAt: -1 })
      .exec();
    
    if (evaluation) {
      // Parse and log FULL data to verify it's the correct evaluation
      try {
        const parsed = JSON.parse(evaluation.evaluationData);
        const flashcard1 = parsed.evaluation?.[0]?.items?.[0];
        const flashcard2 = parsed.evaluation?.[0]?.items?.[1];
        const mcq1 = parsed.evaluation?.[1]?.items?.[0];
        const mcq2 = parsed.evaluation?.[1]?.items?.[1];
        const fill1 = parsed.evaluation?.[2]?.items?.[0];
        const fill2 = parsed.evaluation?.[2]?.items?.[1];
        
        console.log('=== BACKEND: Evaluation found ===');
        console.log('MediaId:', mediaId);
        console.log('PersonalizationId requested:', personalizationId);
        console.log('Evaluation PersonalizationId:', evaluation.personalizationId ? String(evaluation.personalizationId) : 'none');
        console.log('Evaluation ID:', evaluation._id);
        console.log('Full evaluationData:', evaluation.evaluationData);
        console.log('Flashcard 1:', {
          prompt: flashcard1?.prompt_de,
          answer: flashcard1?.answer_de,
        });
        console.log('Flashcard 2:', {
          prompt: flashcard2?.prompt_de,
          answer: flashcard2?.answer_de,
        });
        console.log('MCQ 1:', {
          prompt: mcq1?.prompt_de,
          options: mcq1?.options_de,
          correctIndex: mcq1?.correct_index,
        });
        console.log('MCQ 2:', {
          prompt: mcq2?.prompt_de,
          options: mcq2?.options_de,
          correctIndex: mcq2?.correct_index,
        });
        console.log('Fill 1:', {
          prompt: fill1?.prompt_de,
          blankSentence: fill1?.blank_sentence_de,
          draggableOptions: fill1?.draggable_options_de,
          correctIndex: fill1?.correct_index,
        });
        console.log('Fill 2:', {
          prompt: fill2?.prompt_de,
          blankSentence: fill2?.blank_sentence_de,
          draggableOptions: fill2?.draggable_options_de,
          correctIndex: fill2?.correct_index,
        });
        console.log('==================================');
      } catch (parseErr) {
        console.error('Evaluation found for mediaId:', mediaId, 'but failed to parse:', parseErr);
        console.error('Raw evaluationData:', evaluation.evaluationData?.substring(0, 500));
      }
    } else {
      console.log('No evaluation found for mediaId:', mediaId);
      
      // Debug: Check if there are any evaluations at all
      const allEvaluations = await this.evaluationModel.find({ isGenerated: true }).limit(5);
      console.log('Debug: Found', allEvaluations.length, 'evaluations in database');
      allEvaluations.forEach((evalItem, idx) => {
        console.log(`  Evaluation ${idx + 1}: mediaId=${evalItem.mediaId}, evaluationId=${evalItem._id}`);
      });
    }
    
    return evaluation;
  }

  async saveProgress(
    userId: string,
    mediaId: string,
    evaluationId: string,
    results: {
      flashcards: { correct: number; total: number };
      mcqs: { correct: number; total: number };
      fillInTheBlanks: { correct: number; total: number };
    },
    cefr: string,
    goal: string,
  ): Promise<Progress> {
    const totalCorrect = results.flashcards.correct + results.mcqs.correct + results.fillInTheBlanks.correct;
    const totalQuestions = results.flashcards.total + results.mcqs.total + results.fillInTheBlanks.total;
    const score = Math.round((totalCorrect / totalQuestions) * 100);

    // Calculate grade
    let grade: string;
    let advice: string;
    if (score >= 90) {
      grade = 'A';
      advice = 'Ausgezeichnet! Du hast ein sehr gutes Verständnis des Materials. Weiter so!';
    } else if (score >= 80) {
      grade = 'B';
      advice = 'Gut gemacht! Du verstehst das Material gut. Übe noch ein wenig, um deine Fähigkeiten zu verbessern.';
    } else if (score >= 70) {
      grade = 'C';
      advice = 'Nicht schlecht! Du hast die Grundlagen verstanden. Wiederhole das Material und übe mehr, um deine Ergebnisse zu verbessern.';
    } else if (score >= 60) {
      grade = 'D';
      advice = 'Du hast einige Konzepte verstanden, aber es gibt noch Raum für Verbesserung. Wiederhole das Material und konzentriere dich auf die Bereiche, in denen du Schwierigkeiten hattest.';
    } else {
      grade = 'F';
      advice = 'Es scheint, als ob du noch Schwierigkeiten mit diesem Material hast. Wiederhole die Lektion, konzentriere dich auf die Grundlagen und übe regelmäßig.';
    }

    const progress = new this.progressModel({
      userId: new Types.ObjectId(userId),
      mediaId: new Types.ObjectId(mediaId),
      evaluationId: new Types.ObjectId(evaluationId),
      score,
      grade,
      results,
      advice,
      cefr,
      goal,
      completedAt: new Date(),
    });

    await progress.save();
    return progress;
  }

  async getShortAnswerFeedback(
    question: string,
    userAnswer: string,
    modelAnswer: string,
    questionEn?: string,
    modelAnswerEn?: string,
  ): Promise<{ feedback: string; correct: boolean; modelAnswer: string }> {
    if (!this.openai) {
      throw new InternalServerErrorException('OpenAI API key is not configured');
    }

    const prompt = `You are a German language learning assistant. A student answered a short comprehension question.

Question (German): ${question}
${questionEn ? `Question (English): ${questionEn}` : ''}

Student's Answer: ${userAnswer}
Correct Model Answer: ${modelAnswer}
${modelAnswerEn ? `Correct Model Answer (English): ${modelAnswerEn}` : ''}

Please provide:
1. Brief feedback on the student's answer (2-3 sentences in German)
2. Whether the answer is correct or not (consider minor spelling variations acceptable)
3. The correct model answer

Return a JSON object with:
{
  "feedback": "Your feedback in German",
  "correct": true/false,
  "modelAnswer": "${modelAnswer}"
}

Be encouraging and educational. If the answer is close but not exact, explain what was missing or incorrect.`;

    try {
      const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const completion = await this.openai.chat.completions.create({
        model: modelName,
        messages: [
          { role: 'system', content: 'You are a helpful German language learning assistant. Return only valid JSON.' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      });

      const rawOutput = (completion.choices[0]?.message?.content || '').trim();
      let cleanedOutput = rawOutput;
      if (rawOutput.includes('```json')) {
        cleanedOutput = rawOutput.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      } else if (rawOutput.includes('```')) {
        cleanedOutput = rawOutput.replace(/```\n?/g, '').trim();
      }

      const parsed = JSON.parse(cleanedOutput);
      
      return {
        feedback: parsed.feedback || 'Gut gemacht!',
        correct: parsed.correct !== undefined ? parsed.correct : false,
        modelAnswer: parsed.modelAnswer || modelAnswer,
      };
    } catch (err: any) {
      console.error('Error generating short answer feedback:', err);
      // Fallback response
      const isCorrect = userAnswer.trim().toLowerCase() === modelAnswer.trim().toLowerCase();
      return {
        feedback: isCorrect 
          ? 'Richtig! Sehr gut!' 
          : `Die richtige Antwort ist: ${modelAnswer}`,
        correct: isCorrect,
        modelAnswer: modelAnswer,
      };
    }
  }

  async getProgressByUserId(userId: string): Promise<Progress[]> {
    return this.progressModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ completedAt: -1 })
      .populate('mediaId', 'title type')
      .exec();
  }

  /**
   * Extract words, concepts, and questions that were used in previously generated questions
   * to avoid repetition in subsequent phases
   */
  private extractUsedContent(items: any[], phaseType: 'flashcard' | 'mcq' | 'fill'): string[] {
    const used: string[] = [];
    
    for (const item of items) {
      if (phaseType === 'flashcard') {
        // Extract the noun/word being tested (from front_de or back_de)
        if (item.front_de) {
          // Extract noun from questions like "Erinnerst du dich an den Artikel zu diesem Nomen "<NOMEN>"?"
          const nounMatch = item.front_de.match(/"([^"]+)"/);
          if (nounMatch) {
            used.push(nounMatch[1].toLowerCase());
          }
        }
        if (item.back_de) {
          // Extract the article+noun answer
          const words = item.back_de.toLowerCase().split(/\s+/);
          used.push(...words);
        }
      } else if (phaseType === 'mcq') {
        // Extract the word/concept being tested
        if (item.front_de) {
          // Extract word from questions like "Welches Wort ist ein Synonym für "<WORD>"?"
          const wordMatch = item.front_de.match(/"([^"]+)"/);
          if (wordMatch) {
            used.push(wordMatch[1].toLowerCase());
          }
        }
        // Extract all choice words
        if (item.choices) {
          for (const choice of item.choices) {
            if (choice.text_de) {
              const words = choice.text_de.toLowerCase().split(/\s+/);
              used.push(...words);
            }
          }
        }
        if (item.options_de) {
          for (const option of item.options_de) {
            const words = option.toLowerCase().split(/\s+/);
            used.push(...words);
          }
        }
      }
    }
    
    // Remove duplicates and return
    return [...new Set(used.filter(w => w.length > 0))];
  }

  private async generateFlashcards(scaffold: any, userProfile: any, personalizationId: string, previouslyUsed: string[]): Promise<any[]> {
    // console.log('=== GENERATING FLASHCARDS ===');
    // console.log('Using Personalization ID:', personalizationId);
    // console.log('User Profile received:', {
    //   cefr: userProfile.cefr,
    //   purpose: userProfile.purpose,
    //   interests: userProfile.interests,
    //   studyMajor: userProfile.studyMajor,
    // });
    // console.log('Scaffold vocabulary count:', scaffold.vocabulary?.length || 0);
    // console.log('Scaffold vocabulary words:', scaffold.vocabulary?.slice(0, 5).map((v: any) => v.word));
    
    const level = (userProfile.cefr || 'B1').toUpperCase();
    const cefrBand =
      level.startsWith('A') ? 'A1-A2' :
      level.startsWith('B') ? 'B1-B2' :
      'C1-C2';

    // Always generate 3 flashcards regardless of user level
    const flashcardCount = 3;

    // Normalize user goal to canonical form
    const normalizedGoal = (userProfile.purpose || 'general').toLowerCase().trim();
    const canonicalGoal = ['vocabulary', 'reading', 'grammar', 'general'].includes(normalizedGoal) 
      ? normalizedGoal 
      : 'general';

    // Map "reading" to "comprehension" for prompt selection
    const promptGoal = canonicalGoal === 'reading' ? 'comprehension' : canonicalGoal;

    console.log('Flashcard Generation Parameters:', {
      userCefr: userProfile.cefr,
      level: level,
      cefrBand: cefrBand,
      flashcardCount: flashcardCount,
      normalizedGoal: normalizedGoal,
      canonicalGoal: canonicalGoal,
      promptGoal: promptGoal,
    });

    // Select the appropriate prompt based on user goal
    let systemPrompt: string;
    let userPrompt: string;

    if (promptGoal === 'vocabulary') {
      console.log('SELECTED: Vocabulary flashcard prompt');
      systemPrompt = `You are a strict JSON-only generator. Temperature 0.0. Return ONLY the requested JSON object. Do NOT output explanations or extra fields.`;
      userPrompt = this.buildVocabularyFlashcardPrompt(userProfile.cefr, flashcardCount, scaffold, previouslyUsed);
    } else if (promptGoal === 'comprehension') {
      console.log('SELECTED: Comprehension flashcard prompt');
      systemPrompt = `You are a strict JSON-only generator. Temperature 0.0. Return ONLY the requested JSON object. Do NOT output explanations.`;
      userPrompt = this.buildComprehensionFlashcardPrompt(userProfile.cefr, flashcardCount, scaffold, previouslyUsed);
    } else if (promptGoal === 'grammar') {
      console.log('SELECTED: Grammar flashcard prompt');
      systemPrompt = `You are a strict JSON-only generator. Temperature 0.0. Return ONLY the requested JSON object. No extra output.`;
      userPrompt = this.buildGrammarFlashcardPrompt(userProfile.cefr, flashcardCount, scaffold, previouslyUsed);
    } else {
      console.log('SELECTED: General (defaulting to vocabulary) flashcard prompt');
      // For "general", use vocabulary prompt as default (or could use a mixed approach)
      systemPrompt = `You are a strict JSON-only generator. Temperature 0.0. Return ONLY the requested JSON object. Do NOT output explanations or extra fields.`;
      userPrompt = this.buildVocabularyFlashcardPrompt(userProfile.cefr, flashcardCount, scaffold, previouslyUsed);
    }

    try {
      // Use OpenAI for evaluation generation (flashcards)
      if (!this.openai) {
        console.error('OpenAI API key is not configured for flashcard generation.');
        return [];
      }

      const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const completion = await this.openai.chat.completions.create({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
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
      const result = Array.isArray(parsed) ? parsed : parsed.flashcards || [];
      
      if (result.length === 0) {
        console.error('No flashcards generated. Raw output:', cleanedOutput.substring(0, 500));
      }

      // Validate that all flashcards match the expected type
      const expectedType = promptGoal === 'vocabulary' ? 'vocabulary' : 
                          promptGoal === 'comprehension' ? 'comprehension' : 
                          promptGoal === 'grammar' ? 'grammar' : 'vocabulary';
      
      const invalidCards = result.filter((card: any) => card.type !== expectedType);
      if (invalidCards.length > 0) {
        console.error(`TYPE MISMATCH ERROR: Expected type "${expectedType}" but found:`, 
          invalidCards.map((c: any) => ({ id: c.id, type: c.type })));
        // Filter out invalid cards
        const validCards = result.filter((card: any) => card.type === expectedType);
        if (validCards.length === 0) {
          console.error('CRITICAL: No valid cards after filtering. This indicates a prompt issue.');
          throw new InternalServerErrorException(`Failed to generate ${expectedType} flashcards. LLM returned incorrect types.`);
        }
        console.warn(`Filtered out ${invalidCards.length} invalid cards. Returning ${validCards.length} valid cards.`);
        return validCards;
      }

      console.log(`Successfully generated ${result.length} ${expectedType} flashcards`);
      
      return result;
    } catch (err) {
      console.error('Error generating flashcards:', err);
      return [];
    }
  }

  private buildVocabularyFlashcardPrompt(userCefr: string, flashcardCount: number, scaffold: any, previouslyUsed: string[] = []): string {
    // Filter to get only the 3 nouns from scaffold vocabulary
    const nouns = (scaffold.vocabulary || []).filter((v: any) => v.partOfSpeech === 'noun').slice(0, 3);
    
    const scaffoldData = {
      vocabulary: scaffold.vocabulary || [],
      nouns: nouns, // The 3 nouns that MUST be used for flashcards
      summary: scaffold.summary || { de: '', en: '' },
      text: scaffold.text || '',
    };

    const previouslyUsedText = previouslyUsed.length > 0 
      ? `\n\nCRITICAL: DO NOT REPEAT QUESTIONS. The following words/concepts have already been used in previous evaluation phases and MUST be avoided:\n${previouslyUsed.map(w => `- "${w}"`).join('\n')}\n\nYou MUST select different nouns/words that are NOT in this list.`
      : '';

    return `You will generate vocabulary flashcards (article questions) from the provided scaffold. Follow every rule below exactly.

INPUT:

{
  "user_cefr": "${userCefr}",
  "flashcard_count": 3,
  "scaffold": ${JSON.stringify(scaffoldData, null, 2)}
}${previouslyUsedText}

MANDATORY ANTI-HALLUCINATION RULES:

1. **USE ONLY THE GENERATED SCAFFOLD**: Use ONLY words and sentences that appear in scaffold.text, scaffold.summary, or scaffold.vocabulary. DO NOT use scaffold.usageInTranscript or any full transcript. The scaffold.text is the generated personalized text, NOT the original transcript. NEVER invent words or translations.

2. **CRITICAL: USE THE 3 NOUNS FROM SCAFFOLD**: You MUST create exactly 3 flashcards, one for EACH of the 3 nouns in scaffold.nouns. These are the nouns from scaffold.vocabulary where partOfSpeech === "noun". You MUST use ALL 3 nouns - do not skip any.

3. Every returned card must include a provenance field source_span: { "start_char": int, "end_char": int } that points into scaffold.text (or scaffold.summary) and contains the noun (or the article+noun used in back_de) verbatim.

4. All German text must be grammatically correct and match the CEFR level constraints below.

5. back_de (the answer) must be **the definite article + noun exactly as it appears in scaffold.nouns** (e.g., if scaffold.nouns has "der Zug", back_de should be "der Zug"). The noun word from scaffold.nouns already includes the article. back_de must be ≤ 3 words.

6. Output EXACTLY 3 flashcards (flashcard_count = 3), one for each noun in scaffold.nouns. If scaffold.nouns has fewer than 3 nouns, return as many flashcards as there are nouns and include "notes":"insufficient_items".

CARD TEMPLATE (MUST FOLLOW):

- front_de: \`Erinnerst du dich an den Artikel zu diesem Nomen "<NOMEN_OHNE_ARTIKEL>"?\`

- front_en: \`Do you remember the article to this noun "<ENGLISH NOUN TRANSLATION>"?\`

- back_de: definite article + noun as in scaffold (e.g., "die Blume")

- back_en: short English gloss (1–3 words)

- confirm_choices: ["✓","✕"]

- instructions_de: "Klicke ✓ wenn richtig, ✕ wenn falsch"

- instructions_en: "Tap ✓ if correct, ✕ if incorrect"

OUTPUT (STRICT JSON) — return ONLY this object:

{
  "flashcards": [
    {
      "id": "fc1",
      "type": "vocabulary",
      "front_de": "...",
      "front_en": "...",
      "back_de": "...",
      "back_en": "...",
      "confirm_choices": ["✓","✕"],
      "instructions_de": "Klicke ✓ wenn richtig, ✕ wenn falsch",
      "instructions_en": "Tap ✓ if correct, ✕ if incorrect",
      "source_span": { "start_char": 0, "end_char": 0 }
    }
  ],
  "notes": "optional or 'insufficient_items'"
}

CRITICAL TYPE ENFORCEMENT:

- EVERY card MUST have "type": "vocabulary". Do NOT generate comprehension or grammar cards.
- If you generate any card with a different type, the system will reject it.

FEEDBACK RULE:

- If you cannot find enough eligible nouns in the scaffold, return as many correct cards as possible and set notes:"insufficient_items".

END.`;
  }

  private buildComprehensionFlashcardPrompt(userCefr: string, flashcardCount: number, scaffold: any, previouslyUsed: string[] = []): string {
    const scaffoldData = {
      summary: scaffold.summary || { de: '', en: '' },
      text: scaffold.text || '',
    };

    const previouslyUsedText = previouslyUsed.length > 0 
      ? `\n\nCRITICAL: DO NOT REPEAT QUESTIONS. The following words/concepts have already been used in previous evaluation phases and MUST be avoided:\n${previouslyUsed.map(w => `- "${w}"`).join('\n')}\n\nYou MUST ask different questions about different facts/concepts that are NOT in this list.`
      : '';

    return `You will generate comprehension flashcards (very short Q/A) from the provided scaffold. Follow the rules exactly.

INPUT:

{
  "user_cefr": "${userCefr}",
  "flashcard_count": 3,
  "scaffold": ${JSON.stringify(scaffoldData, null, 2)}
}${previouslyUsedText}

MANDATORY ANTI-HALLUCINATION RULES:

1. **USE ONLY THE GENERATED SCAFFOLD**: Use ONLY content found verbatim in scaffold.summary or scaffold.text. The scaffold.text is the generated personalized text, NOT the original transcript. DO NOT use any full transcript or scaffold.usageInTranscript. Do NOT invent facts or paraphrase beyond scaffold content.

2. Every returned back_de answer MUST be a short phrase (maximum **3 words**) that appears verbatim in scaffold.summary or scaffold.text.

3. Each card MUST include "source_span" that points to where the back_de appears in scaffold.text or scaffold.summary.

4. All German must be correct and level-appropriate per CEFR rules below.

5. Output EXACTLY 3 flashcards (flashcard_count = 3). Always generate 3 flashcards regardless of user CEFR level. If scaffold lacks eligible items, return as many as possible (up to 3) and set notes:"insufficient_items".

CEFR ADAPTATION FOR COMPREHENSION QUESTIONS:

- A1–A2: ask **very simple gist** questions (topic label, main actor, simple fact). Expect single-word or short-phrase answers (e.g., "Reise", "Zug", "München").

- B1–B2: ask **key fact** or short detail questions (who/what/where/when), answers up to 2–3 words.

- C1–C2: ask **nuance/stance** questions (author attitude, short label like "kritisch", "positiv") still limited to ≤ 3 words.

QUESTION STYLE:

- front_de: a short German question ≤ 8 words, for example "Kurz: Hauptthema?" or "Wer ist die Person?"

- front_en: direct English translation of front_de.

- back_de: short answer ≤ 3 words from scaffold.summary/text.

- back_en: English translation of back_de.

OUTPUT (STRICT JSON):

{
  "flashcards": [
    {
      "id":"fc1",
      "type":"comprehension",
      "front_de":"...",
      "front_en":"...",
      "back_de":"...",
      "back_en":"...",
      "confirm_choices":["✓","✕"],
      "instructions_de":"Klicke ✓ wenn richtig, ✕ wenn falsch",
      "instructions_en":"Tap ✓ if correct, ✕ if incorrect",
      "source_span": { "start_char": 0, "end_char": 0 }
    }
  ],
  "notes":"optional or 'insufficient_items'"
}

CRITICAL TYPE ENFORCEMENT:

- EVERY card MUST have "type": "comprehension". Do NOT generate vocabulary or grammar cards.
- If you generate any card with a different type, the system will reject it.

FEEDBACK:

- If you cannot produce the requested number of cards because scaffold lacks concise answers, return fewer and set notes:"insufficient_items".

END.`;
  }

  private buildGrammarFlashcardPrompt(userCefr: string, flashcardCount: number, scaffold: any, previouslyUsed: string[] = []): string {
    // Filter to get only the 3 verbs from scaffold vocabulary
    const verbs = (scaffold.vocabulary || []).filter((v: any) => v.partOfSpeech === 'verb').slice(0, 3);
    
    const scaffoldData = {
      vocabulary: scaffold.vocabulary || [],
      verbs: verbs, // The 3 verbs that MUST be used for flashcards (each has "word" = conjugated form, "infinitive" = infinitive form)
      text: scaffold.text || '',
    };

    const previouslyUsedText = previouslyUsed.length > 0 
      ? `\n\nCRITICAL: DO NOT REPEAT QUESTIONS. The following words/concepts have already been used in previous evaluation phases and MUST be avoided:\n${previouslyUsed.map(w => `- "${w}"`).join('\n')}\n\nYou MUST select different verbs that are NOT in this list.`
      : '';

    return `You will generate grammar flashcards that ask for infinitive (Grundform) of conjugated verbs found in the scaffold. Follow all rules exactly.

INPUT:

{
  "user_cefr": "${userCefr}",
  "flashcard_count": 3,
  "scaffold": ${JSON.stringify(scaffoldData, null, 2)}
}${previouslyUsedText}

MANDATORY RULES:

1. **USE ONLY THE GENERATED SCAFFOLD**: Use ONLY conjugated verb tokens that appear verbatim in scaffold.text. The scaffold.text is the generated personalized text, NOT the original transcript. DO NOT use scaffold.usageInTranscript or any full transcript.

2. **CRITICAL: USE THE 3 VERBS FROM SCAFFOLD**: You MUST create exactly 3 flashcards, one for EACH of the 3 verbs in scaffold.verbs. These are the verbs from scaffold.vocabulary where partOfSpeech === "verb". Each verb in scaffold.verbs has:
   - "word": the conjugated form as it appears in the transcript/scaffold
   - "infinitive": the infinitive form (Grundform)
   You MUST use ALL 3 verbs - do not skip any.

3. Each card front must include the conjugated form from scaffold.verbs[].word (e.g., if scaffold.verbs[0].word = "geht", front_de should show "geht").

4. Each back_de must be the infinitive form from scaffold.verbs[].infinitive (e.g., if scaffold.verbs[0].infinitive = "gehen", back_de should be "gehen"). The infinitive must be ≤ 2 words.

5. Provide a provenance field source_span pointing to where the conjugated verb (scaffold.verbs[].word) appears in scaffold.text.

6. All German must be correct and appropriate to the CEFR level rules below.

7. Output EXACTLY 3 flashcards (flashcard_count = 3), one for each verb in scaffold.verbs. If scaffold.verbs has fewer than 3 verbs, return as many flashcards as there are verbs and set notes:"insufficient_items".

CEFR ADAPTATION (grammar complexity):

- A1–A2: choose simple present tense verbs or very frequent irregulars (e.g., "geht" -> "gehen").

- B1–B2: include compound tenses or separable verbs if present (e.g., "ist gefahren" -> "fahren"; "steht auf" -> "aufstehen").

- C1–C2: pick more complex verb forms (modal + perfect, Konjunktiv examples) if present. Still return infinitive ≤ 2 words.

CARD TEMPLATE:

- front_de: \`Erinnerst du dich an die Grundform (Infinitiv) dieses Verbs "<KONJUGIERTE_FORM>"?\`

- front_en: \`Do you remember the infinitive form to this verb "<CONJUGATED_FORM>"?\`

- back_de: infinitive (e.g., "sein", "aufstehen")

- back_en: short English gloss (e.g., "to be", "to get up")

- confirm_choices: ["✓","✕"]

- instructions_de/instructions_en as before

OUTPUT (STRICT JSON):

{
  "flashcards":[
    {
      "id":"fc1",
      "type":"grammar",
      "front_de":"...",
      "front_en":"...",
      "back_de":"...",
      "back_en":"...",
      "confirm_choices":["✓","✕"],
      "instructions_de":"Klicke ✓ wenn richtig, ✕ wenn falsch",
      "instructions_en":"Tap ✓ if correct, ✕ if incorrect",
      "source_span": { "start_char": 0, "end_char": 0 }
    }
  ],
  "notes":"optional or 'insufficient_items'"
}

CRITICAL TYPE ENFORCEMENT:

- EVERY card MUST have "type": "grammar". Do NOT generate vocabulary or comprehension cards.
- If you generate any card with a different type, the system will reject it.

VALIDATION NOTE FOR THE MODEL:

- front_de/front_en must contain exactly the conjugated verb as found in the scaffold.

- back_de must be the true infinitive. If the conjugated form cannot be mapped to an infinitive deterministically, omit that verb candidate.

END.`;
  }

  private buildVocabularyMCQPrompt(userCefr: string, choicesCount: number, scaffold: any, previouslyUsed: string[] = [], spacyWords: { nouns: string[]; verbs: string[]; adjectives: string[] } | null = null): string {
    const scaffoldData = {
      vocabulary: scaffold.vocabulary || [],
      summary: scaffold.summary || { de: '', en: '' },
      text: scaffold.text || '',
      usageInTranscript: scaffold.usageInTranscript || [],
    };

    const previouslyUsedText = previouslyUsed.length > 0 
      ? `\n\nAvoid these words (already used): ${previouslyUsed.join(', ')}`
      : '';

    const spacyWordsText = spacyWords 
      ? `\n\nSpaCy arrays (select 2 words from here - one for synonym, one for antonym):
- Nouns: ${JSON.stringify(spacyWords.nouns)}
- Verbs: ${JSON.stringify(spacyWords.verbs)}
- Adjectives: ${JSON.stringify(spacyWords.adjectives)}`
      : '';

    // Determine CEFR level for distractor strategy
    const level = (userCefr || 'B1').toUpperCase();
    const cefrLevel = level.startsWith('A1') ? 'A1' :
                     level.startsWith('A2') ? 'A2' :
                     level.startsWith('B1') ? 'B1' :
                     level.startsWith('B2') ? 'B2' :
                     level.startsWith('C1') ? 'C1' : 'C2';

    const cefrDistractorRules = {
      'A1': 'completely unrelated words',
      'A2': 'mostly unrelated words',
      'B1': 'somewhat related words (same topic, different meaning)',
      'B2': 'similar meaning but not exact (near-synonyms)',
      'C1': 'very close in meaning (subtle distinctions)',
      'C2': 'almost synonymous or nearly direct opposites'
    };

    return `Return JSON only. Generate 2 vocabulary MCQs (1 synonym + 1 antonym).

Input:
{
  "cefr_level": "${cefrLevel}",
  "choices_count": ${choicesCount},
  "scaffold": ${JSON.stringify(scaffoldData, null, 2)}${spacyWordsText}${previouslyUsedText}
}

Rules:
1. Select 2 words from spaCy arrays above (one for synonym question, one for antonym question). Selected words must appear in scaffold.text.
2. Correct answer: MUST be a real German synonym (for synonym question) or antonym (for antonym question). Find it in scaffold.text or scaffold.vocabulary. It must be a genuine synonym/antonym of the target word.
3. Distractors: generate ${choicesCount - 1} German words that are NOT synonyms/antonyms of the target word. For ${cefrLevel}, use ${cefrDistractorRules[cefrLevel]}.
4. CRITICAL - TARGET WORD EXCLUSION: The target word (the word being asked about in the question, e.g., the word inside quotes in "Welches Wort ist ein Synonym für \"[WORD]\"?") MUST NOT appear anywhere in the choices array. This is a hard requirement - if the target word appears in any choice, the MCQ is invalid. Check each choice carefully and ensure NONE of them contain the target word in any form (exact match, as part of a compound word, or as a substring).
5. CRITICAL - CONTEXT SENTENCE VERIFICATION: context_sentence_de MUST be the exact, complete sentence from scaffold.text where the target word actually appears. Before outputting, verify: (a) the sentence exists verbatim in scaffold.text, (b) the target word appears in that sentence. If you cannot find the sentence containing the target word, do not generate the MCQ.

Output format:
{
  "mcqs": [
    {
      "id": "mcq1",
      "type": "vocabulary",
      "front_de": "Welches Wort ist ein Synonym für \"[WORD]\"?",
      "front_en": "Which word is a synonym of \"[WORD]\"?",
      "context_sentence_de": "[sentence from scaffold.text]",
      "context_sentence_en": "[English translation]",
      "choices": [
        {"text_de": "...", "text_en": "..."}
      ],
      "correct_index": 0,
      "source_span": {"start_char": 0, "end_char": 0}
    },
    {
      "id": "mcq2",
      "type": "vocabulary",
      "front_de": "Welches Wort ist das Gegenteil von \"[WORD]\"?",
      "front_en": "Which word is the antonym of \"[WORD]\"?",
      "context_sentence_de": "[sentence from scaffold.text]",
      "context_sentence_en": "[English translation]",
      "choices": [
        {"text_de": "...", "text_en": "..."}
      ],
      "correct_index": 0,
      "source_span": {"start_char": 0, "end_char": 0}
    }
  ]
}

Requirements:
- EXACTLY ${choicesCount} choices per MCQ (this is MANDATORY - the system will reject MCQs with incorrect count)
- Target words from spaCy arrays only
- Correct answers must be real synonyms/antonyms
- Distractors follow ${cefrLevel} strategy: ${cefrDistractorRules[cefrLevel]}
- ABSOLUTE REQUIREMENT: Target word MUST NOT appear in choices array (check every choice text_de value)
- ABSOLUTE REQUIREMENT: context_sentence_de must be the exact sentence from scaffold.text containing the target word (verify it exists in scaffold.text and contains the target word)
- ABSOLUTE REQUIREMENT: context_sentence_en must be provided - it is the English translation of context_sentence_de

VALIDATION CHECKLIST (verify before outputting):
✓ Exactly ${choicesCount} choices in the choices array (count them!)
✓ Target word does NOT appear in any choice text_de
✓ context_sentence_de exists in scaffold.text
✓ Target word appears in context_sentence_de
✓ context_sentence_en is provided (English translation of context_sentence_de)
✓ All choices are valid German words/phrases`;
  }

  private buildComprehensionMCQPrompt(userCefr: string, choicesCount: number, scaffold: any, previouslyUsed: string[] = []): string {
    const scaffoldData = {
      summary: scaffold.summary || { de: '', en: '' },
      text: scaffold.text || '',
    };

    const previouslyUsedText = previouslyUsed.length > 0 
      ? `\n\nCRITICAL: DO NOT REPEAT QUESTIONS. The following words/concepts have already been used in previous evaluation phases (flashcards) and MUST be avoided:\n${previouslyUsed.map(w => `- "${w}"`).join('\n')}\n\nYou MUST ask different questions about different facts/concepts that are NOT in this list.`
      : '';

    return `Generate exactly 2 comprehension MCQs about the content of the scaffold. Use only facts/phrases that appear verbatim in scaffold.summary or scaffold.text. Do NOT invent facts.

INPUT:

{
  "user_cefr": "${userCefr}",
  "choices_count": ${choicesCount},
  "scaffold": ${JSON.stringify(scaffoldData, null, 2)}
}${previouslyUsedText}

MANDATORY RULES:

1. Use ONLY scaffold.summary and scaffold.text; every correct choice (and ideally distractors) must be drawn from or grounded in scaffold text.

2. Each question must ask a short factual detail (who/what/where/when/main topic) whose **correct answer** is a short phrase that appears verbatim in scaffold.summary/text.

3. back_de (the correct choice text_de) must be ≤ 3 words.

4. Provide provenance: source_span points to where the correct phrase appears in scaffold.text or scaffold.summary.

5. Ensure choices_count options for each question, with exactly one correct option.

6. German UI and questions must be in front_de; front_en must be faithful English translation.

CEFR ADAPTATION (question complexity):

- A1–A2: ask gist/main topic or simple actors/places (one-word answers).

- B1–B2: ask short factual details (dates, locations, short named entities).

- C1–C2: ask about stance, short labels, or nuance (still ≤ 3 words).

QUESTION STYLE EXAMPLES (do not output these to user; model should follow similar):

- \`Kurz: Hauptthema?\` → choices = short topic labels from scaffold.

- \`Wer ist die Person?\` → choices = person names as in scaffold.

OUTPUT (STRICT JSON):

{
  "mcqs": [
    {
      "id": "mcq1",
      "type": "comprehension",
      "front_de": "...",
      "front_en": "...",
      "choices": [
        {
          "text_de": "...",
          "text_en": "..."
        }
      ],
      "correct_index": 0,
      "source_span": { "start_char": 0, "end_char": 0 }
    }
  ],
  "notes": "optional or 'insufficient_items'"
}

**CRITICAL: Each MCQ's "choices" array MUST contain exactly ${choicesCount} items (one correct answer plus ${choicesCount - 1} distractors). The array length must be exactly ${choicesCount}, not more, not less.**

CRITICAL TYPE ENFORCEMENT:

- EVERY MCQ MUST have "type": "comprehension". Do NOT generate vocabulary or grammar MCQs.
- If you generate any MCQ with a different type, the system will reject it.

END.`;
  }

  private buildGrammarMCQPrompt(userCefr: string, choicesCount: number, scaffold: any, previouslyUsed: string[] = []): string {
    const scaffoldData = {
      text: scaffold.text || '',
      usageInTranscript: scaffold.usageInTranscript || [],
    };

    const allowedLabels = choicesCount === 3 
      ? '{Präsens, Perfekt, Präteritum}'
      : choicesCount === 4
      ? '{Präsens, Perfekt, Präteritum, Konjunktiv II OR Passiv}'
      : '{Präsens, Präteritum, Perfekt, Plusquamperfekt, Futur I, Futur II, Konjunktiv I, Konjunktiv II, Passiv, Modal + Infinitive}';

    const previouslyUsedText = previouslyUsed.length > 0 
      ? `\n\nCRITICAL: DO NOT REPEAT QUESTIONS. The following words/concepts have already been used in previous evaluation phases (flashcards) and MUST be avoided:\n${previouslyUsed.map(w => `- "${w}"`).join('\n')}\n\nYou MUST select different verbs that are NOT in this list.`
      : '';

    return `Generate exactly 2 grammar MCQs that ask the learner to identify the **tense/mood/voice** of a German verb that appears in scaffold.text. Use only the scaffold. Do NOT invent verbs or contexts.

INPUT:

{
  "user_cefr": "${userCefr}",
  "choices_count": ${choicesCount},
  "scaffold": ${JSON.stringify(scaffoldData, null, 2)}
}${previouslyUsedText}

MANDATORY RULES:

1. Choose conjugated verb tokens that appear verbatim in scaffold.text.

2. For each question, include the conjugated verb exactly in the front_de/front_en prompt.

3. **CRITICAL: Extract the complete sentence from scaffold.text where the conjugated verb appears. This sentence must be included in context_sentence_de. The sentence helps learners understand the context of the verb. The sentence must be the exact sentence containing the verb in question.**

4. The correct choice is the tense (or mood) label that accurately describes the given conjugated form.

5. Provide provenance: source_span must point to the conjugated verb occurrence in scaffold.text.

6. Choices must be tense/mood labels in German (choice.text_de) and English (choice.text_en). Use only the allowed labels listed below.

7. Exactly one correct choice per MCQ.

8. Constrain labels per CEFR (below).

ALLOWED TENSE/MOOD LABELS (use these exact German labels and give faithful English in text_en):

- Präsens (Present)

- Präteritum (Simple past)

- Perfekt (Present perfect)

- Plusquamperfekt (Past perfect)

- Futur I (Future I)

- Futur II (Future II)

- Konjunktiv I (Subjunctive I)

- Konjunktiv II (Subjunctive II)

- Passiv (Passive)     // use when appropriate (e.g. "wurde gesagt")

- Modal + Infinitive (Modal + infinitive) // only used as composite label if verb form includes a modal

CEFR ADAPTATION (which labels to include in choices):

- A1–A2 (3 choices): choose among ${allowedLabels}

- B1–B2 (4 choices): {Präsens, Perfekt, Präteritum, Konjunktiv II OR Passiv} — prefer Konjunktiv II if present, else include Passiv if present.

- C1–C2 (5 choices): include 5 distinct labels drawn from the full allowed list (include Konjunktiv I/II, Futur I/II, Passiv, Plusquamperfekt if they are relevant or plausible).

QUESTION TEMPLATE (must use similar phrasing):

- front_de: \`Welche Zeit ist „<KONJUGIERTE_FORM>"?\`

- front_en: \`Which tense is "<CONJUGATED_FORM>"?\`

OUTPUT (STRICT JSON):

{
  "mcqs": [
    {
      "id": "mcq1",
      "type": "grammar",
      "front_de": "...",
      "front_en": "...",
      "context_sentence_de": "EXACT COMPLETE SENTENCE FROM scaffold.text WHERE THE VERB APPEARS",
      "context_sentence_en": "English translation of the context sentence",
      "choices": [
        {
          "text_de": "...",
          "text_en": "..."
        }
      ],
      "correct_index": 0,
      "source_span": { "start_char": 0, "end_char": 0 }
    }
  ],
  "notes": "optional or 'insufficient_items'"
}

**CRITICAL: Each MCQ's "choices" array MUST contain exactly ${choicesCount} items (one correct answer plus ${choicesCount - 1} distractors). The array length must be exactly ${choicesCount}, not more, not less.**

CRITICAL TYPE ENFORCEMENT:

- EVERY MCQ MUST have "type": "grammar". Do NOT generate vocabulary or comprehension MCQs.
- If you generate any MCQ with a different type, the system will reject it.

VALIDATION:

- server must verify that scaffold.text.slice(start_char,end_char) equals the conjugated token shown in the front.

- correct_index must point to the right tense label.

If not enough eligible conjugated verbs exist, return fewer items and notes:"insufficient_items".

END.`;
  }

  private async generateMCQs(scaffold: any, userProfile: any, personalizationId: string, previouslyUsed: string[]): Promise<any[]> {
    // console.log('=== GENERATING MCQs ===');
    // console.log('Using Personalization ID:', personalizationId);
    // console.log('User Profile received:', {
    //   cefr: userProfile.cefr,
    //   purpose: userProfile.purpose,
    // });
    // console.log('Scaffold vocabulary count:', scaffold.vocabulary?.length || 0);
    // console.log('Scaffold summary preview:', scaffold.summary?.de?.substring(0, 100));

    const level = (userProfile.cefr || 'B1').toUpperCase();
    const cefrBand =
      level.startsWith('A') ? 'A1-A2' :
      level.startsWith('B') ? 'B1-B2' :
      'C1-C2';

    const optionsCount =
      cefrBand === 'A1-A2' ? 3 :
      cefrBand === 'B1-B2' ? 4 :
      5; // C1-C2

    const questionCount = 2;

    // Normalize user goal to canonical form
    const normalizedGoal = (userProfile.purpose || 'general').toLowerCase().trim();
    const canonicalGoal = ['vocabulary', 'reading', 'grammar', 'general'].includes(normalizedGoal) 
      ? normalizedGoal 
      : 'general';

    // Map "reading" to "comprehension" for prompt selection
    const promptGoal = canonicalGoal === 'reading' ? 'comprehension' : canonicalGoal;

    console.log('MCQ Generation Parameters:', {
      userCefr: userProfile.cefr,
      level: level,
      cefrBand: cefrBand,
      optionsCount: optionsCount,
      normalizedGoal: normalizedGoal,
      canonicalGoal: canonicalGoal,
      promptGoal: promptGoal,
    });

    // For vocabulary goals, get spaCy word arrays from transcript
    let spacyWords: { nouns: string[]; verbs: string[]; adjectives: string[] } | null = null;
    if (promptGoal === 'vocabulary') {
      try {
        // Get transcript from scaffold.text (full transcript text)
        const transcript = scaffold.text || '';
        if (transcript && transcript.trim().length > 0) {
          console.log('Extracting POS tags with spaCy for vocabulary MCQs...');
          console.log('Transcript length:', transcript.length);
          spacyWords = await this.spacyPosService.extractPosTags(transcript);
          console.log('SpaCy word arrays:', {
            nouns: spacyWords.nouns.length,
            verbs: spacyWords.verbs.length,
            adjectives: spacyWords.adjectives.length,
            sampleNouns: spacyWords.nouns.slice(0, 5),
            sampleVerbs: spacyWords.verbs.slice(0, 5),
            sampleAdjectives: spacyWords.adjectives.slice(0, 5),
          });
        } else {
          console.warn('No transcript text available in scaffold.text for spaCy extraction');
        }
      } catch (error) {
        console.warn('Failed to extract POS tags with spaCy:', error);
        // Continue without spaCy words - will use scaffold vocabulary instead
      }
    }

    // Select the appropriate prompt based on user goal
    let systemPrompt: string;
    let userPrompt: string;

    if (promptGoal === 'vocabulary') {
      console.log('SELECTED: Vocabulary MCQ prompt');
      systemPrompt = `You are a JSON-only generator. Temperature 0.0. Return ONLY the JSON described below. No commentary.`;
      userPrompt = this.buildVocabularyMCQPrompt(userProfile.cefr, optionsCount, scaffold, previouslyUsed, spacyWords);
    } else if (promptGoal === 'comprehension') {
      console.log('SELECTED: Comprehension MCQ prompt');
      systemPrompt = `You are a JSON-only generator. Temperature 0.0. Return ONLY the JSON described below.`;
      userPrompt = this.buildComprehensionMCQPrompt(userProfile.cefr, optionsCount, scaffold, previouslyUsed);
    } else if (promptGoal === 'grammar') {
      console.log('SELECTED: Grammar MCQ prompt');
      systemPrompt = `JSON-only generator. Temperature 0.0. Return ONLY the JSON object described below.`;
      userPrompt = this.buildGrammarMCQPrompt(userProfile.cefr, optionsCount, scaffold, previouslyUsed);
    } else {
      console.log('SELECTED: General (defaulting to vocabulary) MCQ prompt');
      systemPrompt = `You are a JSON-only generator. Temperature 0.0. Return ONLY the JSON described below. No commentary.`;
      userPrompt = this.buildVocabularyMCQPrompt(userProfile.cefr, optionsCount, scaffold, previouslyUsed);
    }

    try {
      // Use OpenAI for evaluation generation (MCQs)
      if (!this.openai) {
        console.error('OpenAI API key is not configured for MCQ generation.');
        return [];
      }

      const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const completion = await this.openai.chat.completions.create({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
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
      const result = Array.isArray(parsed) ? parsed : parsed.mcqs || [];
      
      if (result.length === 0) {
        console.error('No MCQs generated. Raw output:', cleanedOutput.substring(0, 500));
      } else {
        console.log(`Generated ${result.length} MCQs`);
      }

      // Validate that all MCQs match the expected type
      const expectedType = promptGoal === 'vocabulary' ? 'vocabulary' : 
                          promptGoal === 'comprehension' ? 'comprehension' : 
                          promptGoal === 'grammar' ? 'grammar' : 'vocabulary';
      
      const invalidMCQs = result.filter((mcq: any) => mcq.type && mcq.type !== expectedType);
      if (invalidMCQs.length > 0) {
        console.error(`TYPE MISMATCH ERROR: Expected type "${expectedType}" but found:`, 
          invalidMCQs.map((m: any) => ({ id: m.id, type: m.type })));
        // Filter out invalid MCQs if type mismatch occurs
        const validMCQs = result.filter((mcq: any) => !mcq.type || mcq.type === expectedType);
        if (validMCQs.length === 0) {
          console.error('CRITICAL: No valid MCQs after filtering. This indicates a prompt issue.');
          throw new InternalServerErrorException(`Failed to generate ${expectedType} MCQs. LLM returned incorrect types.`);
        }
        console.warn(`Filtered out ${invalidMCQs.length} invalid MCQs. Returning ${validMCQs.length} valid MCQs.`);
        return validMCQs;
      }

      console.log(`Successfully generated ${result.length} ${expectedType} MCQs`);
      
      return result;
    } catch (err: any) {
      console.error('Error generating MCQs:', err);
      const errorOutput = err?.response?.data || err?.message || 'No output';
      console.error('Raw output that failed:', typeof errorOutput === 'string' ? errorOutput.substring(0, 500) : JSON.stringify(errorOutput).substring(0, 500));
      throw err;
    }
  }

  private buildVocabularyFillInPrompt(userCefr: string, blanksCount: number, scaffold: any, previouslyUsed: string[] = []): string {
    const scaffoldData = {
      vocabulary: scaffold.vocabulary || [],
      summary: scaffold.summary || { de: '', en: '' },
      text: scaffold.text || '',
      usageInTranscript: scaffold.usageInTranscript || [],
    };

    const previouslyUsedText = previouslyUsed.length > 0 
      ? `\n\nCRITICAL: DO NOT REPEAT QUESTIONS. The following words/concepts have already been used in previous evaluation phases (flashcards and MCQs) and MUST be avoided:\n${previouslyUsed.map(w => `- "${w}"`).join('\n')}\n\nYou MUST select different nouns/words for your fill-in-the-blank items that are NOT in this list.`
      : '';

    return `You are a JSON-only generator. Run at temperature 0.0. RETURN ONLY VALID JSON (no explanation text).

Task: generate exactly **2 fill-in-the-blank items** that test **vocabulary: German articles (PRIORITY) and vocabulary words (FALLBACK)**. Use ONLY content from the provided scaffold. Do NOT invent sentences, words, or translations.

**CRITICAL ANTI-HALLUCINATION RULES (ABSOLUTE - NO EXCEPTIONS):**

1. **ONLY USE SENTENCES FROM SCAFFOLD**: Every sentence you use for fill-in-the-blank items MUST appear verbatim in scaffold.text or scaffold.summary. You MUST NOT create, invent, modify, or paraphrase sentences.

2. **NO HALLUCINATION**: You MUST NOT generate any content that does not exist in the scaffold. This includes:
   - DO NOT invent new sentences
   - DO NOT combine parts from different sentences to create new sentences
   - DO NOT modify sentence structure or word order
   - DO NOT add words that are not in the scaffold
   - DO NOT create translations that don't match the scaffold

3. **VERIFICATION REQUIRED**: Every word, phrase, and sentence you use MUST be traceable to scaffold.text, scaffold.summary, or scaffold.vocabulary. If you cannot verify a piece of content in the scaffold, DO NOT use it.

4. **EXACT MATCHES ONLY**: When selecting sentences, use them exactly as they appear in the scaffold. The only modification allowed is removing specific words/articles to create blanks - everything else must remain identical.

5. **PROFESSIONAL ACCURACY**: This is a professional educational system. Accuracy and fidelity to source material are paramount. Any hallucinated content will cause system failures and harm learners.

**CRITICAL REQUIREMENT: Each of the 2 items MUST have exactly 1 blank (use __[1]__).**

**ABSOLUTE RULE: Vocabulary fill-in-the-blanks ALWAYS use exactly 1 blank per sentence, regardless of user CEFR level. You MUST generate exactly 1 placeholder (__[1]__) in each sentence_de and sentence_en. Do NOT generate fewer or more blanks.**

**PRIORITY RULES FOR SELECTING BLANKS (MANDATORY ORDER):**

1. **FIRST PRIORITY: German Articles** - Always prioritize creating blanks on German articles (der, die, das, den, dem, des, ein, eine, einen, einem, eines, etc.) that appear in the sentence. Remove ONLY the article, keep the noun.

2. **SECOND PRIORITY: Vocabulary Words** - ONLY if there are no articles in the sentence, then use a vocabulary word (noun, verb, adjective, etc.) from the sentence. Remove the entire word/phrase.

**SELECTION PROCESS:**
- Step 1: Check if the sentence contains any German articles
- Step 2: If articles exist: Use 1 article for the blank (remove ONLY the article, keep the noun)
- Step 3: If no articles exist: Use 1 vocabulary word from the sentence

**EXAMPLES:**
- Sentence with articles: Use 1 article → \`__[1]__ Mann liest das Buch.\` (removed "Der")
- Sentence with no articles: Use 1 vocabulary word → \`"Der Mann __[1]__ das Buch."\` (removed "liest")

INPUT:

{
  "user_cefr": "${userCefr}",
  "blanks_count": ${blanksCount},
  "scaffold": ${JSON.stringify(scaffoldData, null, 2)}
}${previouslyUsedText}

MANDATORY RULES (ABSOLUTE):

1. ALWAYS return exactly **2** items in "fill_items". If scaffold lacks eligible sentences, return as many valid items as possible (max 2) and set "notes":"insufficient_items".

2. **EACH item MUST have exactly 1 blank (__[1]__)**. For each item, select a sentence from scaffold.text or scaffold.summary that contains at least 1 German article OR 1 vocabulary word.

3. **MANDATORY SELECTION PROCESS FOR EACH ITEM:**
   
   a. **First, check if the sentence contains any German articles** (der, die, das, den, dem, des, ein, eine, einen, einem, eines, etc.)
   
   b. **If the sentence has at least 1 article:**
      - Use exactly 1 article for the blank
      - Remove ONLY the article, keep the noun
      - Example: Sentence \`"Der Mann liest das Buch."\` → \`__[1]__ Mann liest das Buch.\` (removed "Der")
   
   c. **If the sentence has no articles:**
      - Use 1 vocabulary word from the sentence (noun, verb, adjective, etc.)
      - Remove the entire word
      - Example: Sentence \`"Der Mann liest das Buch."\` → \`"Der Mann __[1]__ das Buch."\` (removed "liest")
   
   d. Replace the removed article/word with placeholder \`__[1]__\`
   
   e. Keep the rest of the sentence exactly as in scaffold (only the selected article/word removed)

4. Provide an English translation sentence (\`sentence_en\`) that mirrors the German sentence and contains the **same placeholder** (e.g., \`__[1]__ man reads the book.\`). Use literal, faithful translations of the scaffold text (no extra inference).

5. For each item produce exactly **5** \`drag_options\` (array length = 5). Each option is an object \`{ "text_de": "...", "text_en": "..." }\`. 

   **CRITICAL: The correct answer(s) MUST ALWAYS be included in the drag_options array.**
   
   Options format depends on what was removed:
   - If an **article** was removed: options should be articles (e.g., "der", "die", "das", "ein", "eine") or article+noun combinations (e.g., "der Mann", "die Frau", "das Haus")
   - If a **vocabulary word** was removed: options should be vocabulary words/phrases (e.g., "Mann", "Buch", "liest", "schön") that match the part of speech of the removed word
   
   **MANDATORY RULES FOR OPTIONS:**
   - The correct answer(s) MUST be present in drag_options at the index(es) specified in correct_indices
   - Distractors should be plausible (same part of speech) and when possible taken from scaffold.vocabulary or scaffold.text
   - All options must be valid German words/phrases that could grammatically fit in the blank
   - For article blanks: include the correct article plus 4 plausible incorrect articles
   - For vocabulary word blanks: include the correct word plus 4 plausible incorrect words from scaffold or common German vocabulary

6. For each item include \`correct_indices\`: an array with exactly 1 integer giving the index in \`drag_options\` that correctly fills \`__[1]__\`. **The length of \`correct_indices\` MUST equal exactly 1** (one index for the single blank).

7. Provide provenance:

   - \`source_span\`: { "start_char": int, "end_char": int } that points to the original sentence in \`scaffold.text\` (or scaffold.summary) used.

   - \`answer_spans\`: array with exactly 1 span (start_char,end_char) for the explicit correct token occurrence in scaffold.text corresponding to the removed word or article—this span must match the original text verbatim. If an article was removed, the span should cover just the article. If a vocabulary word was removed, the span should cover the entire word.

8. All German must be grammatically correct and CEFR-appropriate (select simpler sentences for A-levels). \`drag_options[*].text_en\` and \`sentence_en\` must be faithful English translations.

OUTPUT JSON SCHEMA (RETURN ONLY):

{
  "fill_items":[
    {
      "id":"fb1",
      "type":"vocabulary",
      "sentence_de":"...",
      "sentence_en":"...",
      "drag_options":[
        { "text_de":"...", "text_en":"..." }, ...
      ],
      "correct_indices":[0,...],
      "source_span": { "start_char": 0, "end_char": 0 },
      "answer_spans":[ {"start_char":0,"end_char":0}, ... ]
    }
  ],
  "notes":"optional or 'insufficient_items'"
}

VALIDATION HINTS (for your backend):

- Verify \`fill_items.length === 2\` (or notes).

- Verify each \`sentence_de\` contains exactly 1 placeholder: \`__[1]__\`.

- Verify \`drag_options.length === 5\`.

- Verify each \`answer_spans[i]\` points to the exact text removed from scaffold.text.

- If any rule fails, return a repair request to the model or fallback to a deterministic generator.

CRITICAL TYPE ENFORCEMENT:

- EVERY fill_item MUST have "type": "vocabulary". Do NOT generate comprehension or grammar fill-ins.
- If you generate any fill_item with a different type, the system will reject it.

END.`;
  }

  private buildComprehensionShortAnswerPrompt(userCefr: string, scaffold: any, previouslyUsed: string[] = []): string {
    const scaffoldData = {
      summary: scaffold.summary || { de: '', en: '' },
      text: scaffold.text || '',
    };

    const previouslyUsedText = previouslyUsed.length > 0 
      ? `\n\nCRITICAL: DO NOT REPEAT QUESTIONS. The following words/concepts have already been used in previous evaluation phases (flashcards and MCQs) and MUST be avoided:\n${previouslyUsed.map(w => `- "${w}"`).join('\n')}\n\nYou MUST select different topics/concepts for your short answer questions that are NOT in this list.`
      : '';

    return `You are a JSON-only generator. Temperature 0.0. RETURN ONLY VALID JSON (no commentary).

Task: generate exactly **2 short answer comprehension questions** that test **reading comprehension**. Each question should require a 1-2 word answer that can be found in scaffold.text or scaffold.summary. Use only scaffold content.

**CRITICAL ANTI-HALLUCINATION RULES (ABSOLUTE - NO EXCEPTIONS):**

1. **ONLY USE CONTENT FROM SCAFFOLD**: Every question and answer MUST be based on content that appears verbatim in scaffold.text or scaffold.summary. You MUST NOT create, invent, modify, or paraphrase content.

2. **NO HALLUCINATION**: You MUST NOT generate any content that does not exist in the scaffold. This includes:
   - DO NOT invent new facts
   - DO NOT combine information from different parts to create new facts
   - DO NOT modify or paraphrase the content
   - DO NOT add information that is not in the scaffold

3. **VERIFICATION REQUIRED**: Every question and answer MUST be traceable to scaffold.text or scaffold.summary. If you cannot verify a piece of content in the scaffold, DO NOT use it.

4. **PROFESSIONAL ACCURACY**: This is a professional educational system. Accuracy and fidelity to source material are paramount. Any hallucinated content will cause system failures and harm learners.

**CRITICAL REQUIREMENT: Each question MUST have a 1-2 word answer.**

INPUT:

{
  "user_cefr":"${userCefr}",
  "scaffold": ${JSON.stringify(scaffoldData, null, 2)}
}${previouslyUsedText}

MANDATORY RULES:

1. ALWAYS produce exactly **2** questions unless scaffold prevents it (then return fewer and notes:"insufficient_items"). **NEVER invent questions to meet the requirement - only use what exists in the scaffold.**

2. **EACH question MUST have a 1-2 word answer** that appears verbatim in scaffold.text or scaffold.summary. Answers should be:
   - Key nouns (e.g., person names, places, objects)
   - Short phrases (e.g., "in München", "der Zug")
   - Maximum 2 words total

3. Questions should test comprehension of:
   - Main topics/themes
   - Key facts (who, what, where, when)
   - Important details from the text

4. Include \`source_span\` for where the answer appears in scaffold.text or scaffold.summary.

5. All German and English must be correct and faithful.

OUTPUT JSON SCHEMA:

{
  "short_answer_items":[
    {
      "id":"sa1",
      "type":"comprehension",
      "question_de":"...",
      "question_en":"...",
      "model_answer_de":"...",
      "model_answer_en":"...",
      "source_span":{ "start_char":0,"end_char":0 }
    }
  ],
  "notes":"optional or 'insufficient_items'"
}

VALIDATION HINTS:

- Ensure each model_answer_de appears verbatim in scaffold.text or scaffold.summary at the indicated span.
- Ensure answers are 1-2 words maximum.
- Ensure questions test comprehension, not just recall.

CRITICAL TYPE ENFORCEMENT:

- EVERY short_answer_item MUST have "type": "comprehension". Do NOT generate vocabulary or grammar questions.
- If you generate any item with a different type, the system will reject it.

END.`;
  }

  /**
   * Generate additional unique verb forms for a given infinitive
   * Used to replace duplicates in grammar fill-in-the-blanks
   * @param infinitive The infinitive form of the verb (e.g., "kommen")
   * @param existingForms Set of normalized forms already used (to avoid duplicates)
   * @param maxForms Maximum number of forms to generate
   * @returns Array of unique verb forms
   */
  private generateAdditionalVerbForms(infinitive: string, existingForms: Set<string>, maxForms: number = 5): string[] {
    const forms: string[] = [];
    const infinitiveLower = infinitive.toLowerCase().trim();
    
    // Common verb form patterns to try
    const patterns: string[] = [];
    
    // Present tense forms (common conjugations)
    if (infinitiveLower.endsWith('en')) {
      const stem = infinitiveLower.slice(0, -2);
      patterns.push(`${stem}e`, `${stem}st`, `${stem}t`, `${stem}en`, `${stem}et`);
    } else if (infinitiveLower.endsWith('n')) {
      const stem = infinitiveLower.slice(0, -1);
      patterns.push(`${stem}e`, `${stem}st`, `${stem}t`, `${stem}n`, `${stem}t`);
    }
    
    // Past tense (simple past)
    if (infinitiveLower.endsWith('en')) {
      const stem = infinitiveLower.slice(0, -2);
      patterns.push(`${stem}te`, `${stem}test`, `${stem}ten`, `${stem}tet`);
    }
    
    // Perfect forms (with haben/sein)
    if (infinitiveLower.endsWith('en')) {
      const stem = infinitiveLower.slice(0, -2);
      // Try common past participles
      patterns.push(`hat ${stem}t`, `hat ${stem}et`, `ist ${stem}t`, `ist ${stem}en`, 
                    `hatte ${stem}t`, `war ${stem}t`, `wird ${infinitiveLower}`);
    }
    
    // Future forms
    patterns.push(`wird ${infinitiveLower}`, `werden ${infinitiveLower}`, `wirst ${infinitiveLower}`);
    
    // Subjunctive (common forms)
    if (infinitiveLower.endsWith('en')) {
      const stem = infinitiveLower.slice(0, -2);
      patterns.push(`${stem}e`, `${stem}est`, `${stem}en`, `${stem}et`);
    }
    
    // Try each pattern and add if unique
    for (const form of patterns) {
      if (forms.length >= maxForms) break;
      const normalized = form.trim().toLowerCase();
      if (!existingForms.has(normalized) && !forms.some(f => f.toLowerCase() === normalized)) {
        forms.push(form.trim());
        existingForms.add(normalized);
      }
    }
    
    // If still need more, try some generic common forms
    const genericForms = ['ist', 'war', 'wird', 'hat', 'hatte', 'wäre', 'würde', 'kann', 'konnte', 'muss', 'musste'];
    for (const form of genericForms) {
      if (forms.length >= maxForms) break;
      const normalized = form.toLowerCase();
      if (!existingForms.has(normalized) && !forms.some(f => f.toLowerCase() === normalized)) {
        forms.push(form);
        existingForms.add(normalized);
      }
    }
    
    return forms;
  }

  private buildGrammarFillInPromptFromSelectedVerbs(
    userCefr: string, 
    selectedVerbs: Array<{
      infinitive: string;
      verb_cefr: string;
      question_de: string;
      correct_form: string;
      original_phrase: string;
    }>, 
    previouslyUsed: string[] = []
  ): string {
    const previouslyUsedText = previouslyUsed.length > 0 
      ? `\n\nCRITICAL: DO NOT REPEAT QUESTIONS. The following words/concepts have already been used in previous evaluation phases (flashcards and MCQs) and MUST be avoided:\n${previouslyUsed.map(w => `- "${w}"`).join('\n')}\n\nYou MUST select different verbs for your fill-in-the-blank items that are NOT in this list.`
      : '';

    const inputData = {
      user_cefr: userCefr,
      selected_verbs: selectedVerbs
    };

    return `SYSTEM:

You are a precise German-language exercise generator. Follow instructions exactly. Do not invent content. Use only the data provided in the INPUT JSON. Output must be valid JSON only (no prose, no Markdown). Keep output compact.

USER:

Task:

For each verb provided in INPUT.selected_verbs, generate ONE fill-in-the-blank question with exactly 1 blank (__[1]__).

**CRITICAL: Each question MUST have exactly 1 blank (__[1]__), regardless of user CEFR level. Grammar fill-in-the-blanks always use exactly 1 blank per sentence.**

For each selected verb:

1. The question_de is already provided in INPUT.selected_verbs - use it EXACTLY as given. It already has __[1]__ in place of the verb form.

2. Provide an English translation of the full question sentence (with exactly 1 blank: __[1]__).

3. Generate 5 UNIQUE drag/drop choices. All must be different forms of the SAME verb.
   - Include "correct_form" from INPUT.selected_verbs as ONE choice.
   - Add 4 UNIQUE distractors (different verb forms). NO duplicates.
   - Place correct_form at any random index (0-4).

4. Set correct_index to the position of "correct_form" in choices array.

5. Provide a short one-sentence rationale for the correct answer (one-line, German or English).

INPUT JSON format:

${JSON.stringify(inputData, null, 2)}${previouslyUsedText}

Important rules (enforced):

- **ABSOLUTE RULE: Grammar fill-in-the-blanks ALWAYS use exactly 1 blank (__[1]__) per sentence, regardless of user CEFR level. You MUST generate exactly 1 placeholder in each question_de and question_en. Do NOT generate fewer or more blanks.**

- **CRITICAL: Use the question_de EXACTLY as provided in INPUT.selected_verbs. Do NOT modify it.**

- **CRITICAL: The correct_form from INPUT.selected_verbs MUST be one of the 5 choices and MUST be at the correct_index.**

- **CRITICAL: All 5 choices must be UNIQUE (no duplicates). All must be different forms of the SAME verb.**

- Output JSON only.

OUTPUT schema (must match exactly):

{
  "questions": [
    {
      "id": 1,
      "infinitive": "kommen",
      "verb_cefr": "B1",
      "question_de": "Sie __[1]__ gestern spät nach Hause gekommen.",
      "question_en": "She __[1]__ home late yesterday.",
      "choices": ["kommt","kam","ist gekommen","werden kommen","gekommen sein"],
      "correct_index": 2,
      "correct_form": "ist gekommen",
      "brief_rationale": "Correct because German perfect uses auxiliary 'sein' + past participle for 'kommen'."
    }
  ]
}

END.`;
  }

  private buildGrammarFillInPrompt(userCefr: string, verbs: string[], occurrences: Array<{infinitive: string; phrase: string}>, previouslyUsed: string[] = []): string {
    const previouslyUsedText = previouslyUsed.length > 0 
      ? `\n\nCRITICAL: DO NOT REPEAT QUESTIONS. The following words/concepts have already been used in previous evaluation phases (flashcards and MCQs) and MUST be avoided:\n${previouslyUsed.map(w => `- "${w}"`).join('\n')}\n\nYou MUST select different verbs for your fill-in-the-blank items that are NOT in this list.`
      : '';

    const inputData = {
      user_cefr: userCefr,
      verbs: verbs,
      occurrences: occurrences
    };
    console.log("spacyverbs======="+verbs+ occurrences);

    return `SYSTEM:

You are a precise German-language exercise generator. Follow instructions exactly. Do not invent content. Use only the data provided in the INPUT JSON. Output must be valid JSON only (no prose, no Markdown). Keep output compact.

USER:

Task:

1) Classify each provided verb (infinitive form provided in INPUT.verbs) into a CEFR label (A1,A2,B1,B2,C1,C2) using conservative linguistic judgment (frequency, morphology, regularity, separability, tense/usage complexity). Be concise and conservative — if uncertain, prefer the *higher* level (to avoid underspecifying).

2) From the verbs that you classified as matching INPUT.user_cefr (exact match), select up to 2 verbs that appear in INPUT.occurrences (see format). If fewer than 2 verbs in that level are available, return only as many questions as possible (0,1 or 2).

3) For each selected verb produce ONE fill-in-the-blank question that:

   **CRITICAL: Each question MUST have exactly 1 blank (__[1]__), regardless of user CEFR level. Grammar fill-in-the-blanks always use exactly 1 blank per sentence.**

   **CRITICAL: You MUST use the EXACT phrase from INPUT.occurrences for the selected verb. The phrase must appear EXACTLY as provided - do NOT modify, paraphrase, or change any words except to replace the target verb with \`__[1]__\`. Every other word in the phrase must remain identical to INPUT.occurrences.**

   - **STEP-BY-STEP PROCESS:**
     
     **STEP 1:** Find ALL phrases in INPUT.occurrences where the infinitive matches the selected verb. There may be multiple occurrences - you MUST choose ONE of them.
     
     **STEP 2:** Copy that phrase EXACTLY as it appears in INPUT.occurrences. Character-for-character exact copy. Do NOT modify anything yet.
     
     **STEP 3:** Identify the verb form in that phrase. It might be:
       - A simple conjugated form (e.g., "kommt", "kam", "komme")
       - Part of a compound verb (e.g., "ist gekommen", "hat gemacht", "wird kommen")
       - The entire verb phrase that needs to be replaced
     
     **STEP 4:** Replace ONLY that verb form with \`__[1]__\`. 
       - If it's a compound like "ist gekommen", replace the ENTIRE compound: "ist gekommen" → "__[1]__"
       - If it's a single word like "kommt", replace just that: "kommt" → "__[1]__"
     
     **STEP 5:** Keep EVERY other word, punctuation, capitalization, and spacing EXACTLY as in INPUT.occurrences.
       - Do NOT change word order
       - Do NOT add words
       - Do NOT remove words
       - Do NOT modify punctuation
       - Do NOT change capitalization
       - Do NOT paraphrase or rephrase

   - **EXAMPLE:**
     * INPUT.occurrences: {"infinitive": "kommen", "phrase": "Sie ist gestern spät nach Hause gekommen."}
     * Your question_de: "Sie __[1]__ gestern spät nach Hause gekommen."
     * Correct choice: "ist gekommen" (exact form from original phrase)
     * You MUST NOT change: "Sie", "gestern", "spät", "nach", "Hause", or the period

   - Provide an English translation of the full question sentence (with exactly 1 blank: \`__[1]__\`) — do NOT translate separate fragments.

   - Provide 5 drag/drop choices. All 5 must be different *forms* of the SAME verb (infinitive given) — include the correct form (matching the original phrase) among them exactly once. The 4 distractors must be plausible alternative conjugations/tense/forms (different person/tense/mode/participle, separable vs. inseparable if applicable). Do not use verbs other than the target verb forms. Do not invent archaic or invalid conjugations.

   - Mark which choice index (0–4) is correct.

4) Output schema exactly as specified below. Do not emit extra fields.

INPUT JSON format:

${JSON.stringify(inputData, null, 2)}${previouslyUsedText}

**VERY IMPORTANT: Look at INPUT.occurrences above. Each occurrence has an "infinitive" and a "phrase". 
You MUST use the EXACT "phrase" from INPUT.occurrences for your questions. 
Do NOT create new phrases or modify the phrases. Only replace the verb with __[1]__.**

Important rules (enforced):

- **ABSOLUTE RULE: Grammar fill-in-the-blanks ALWAYS use exactly 1 blank (__[1]__) per sentence, regardless of user CEFR level. You MUST generate exactly 1 placeholder in each question_de and question_en. Do NOT generate fewer or more blanks.**

- **CRITICAL: Use ONLY verbs listed in INPUT.verbs and ONLY phrases in INPUT.occurrences. You MUST NOT use any transcript content beyond what is provided in INPUT.occurrences. Every phrase you use MUST appear exactly as provided in INPUT.occurrences.**

- **CRITICAL: The phrase in each question MUST be an EXACT copy from INPUT.occurrences. Do NOT modify, paraphrase, or change the phrase in any way except to replace the verb with __[1]__. The phrase must match character-for-character with what is in INPUT.occurrences.**

- **CRITICAL: When generating choices, the correct answer MUST be the exact verb text that was in the original phrase from INPUT.occurrences. Extract the verb form EXACTLY as it appears in the phrase (case, word order, auxiliaries, participles).**

- **CRITICAL: The correct choice (at the index specified in correct_index) MUST be the exact verb form that was removed from the phrase. If the original phrase was "Sie ist gekommen", and you replace "ist gekommen" with __[1]__, then "ist gekommen" MUST be one of the 5 choices and MUST be at the correct_index.**

- If the original phrase used auxiliary + past participle (e.g., "ist gekommen"), the correct choice must match that full form exactly (e.g., "ist gekommen", not just "gekommen").

- **VALIDATION CHECK: Before submitting, verify that:**
  1. The phrase in question_de matches a phrase from INPUT.occurrences (with only the verb replaced by __[1]__)
  2. The correct answer (the verb form from the original phrase) is present in the choices array
  3. The correct_index points to the position of the correct answer in the choices array

- Provide a short one-sentence rationale for each question's correct answer (one-line, German or English).

- Output JSON only.

OUTPUT schema (must match exactly):

{
  "classified": [{"infinitive":"gehen","cefr":"A1"}, ...],      // classification for every verb from INPUT.verbs
  "questions": [
    {
      "id": 1,
      "infinitive": "kommen",
      "verb_cefr": "B1",
      "question_de": "Sie __[1]__ gestern spät nach Hause gekommen.",
      "question_en": "She __[1]__ home late yesterday.",
      "choices": ["kommt","kam","ist gekommen","werden kommen","gekommen sein"],
      "correct_index": 2,
      "correct_form": "ist gekommen",
      "brief_rationale": "Correct because German perfect uses auxiliary 'sein' + past participle for 'kommen'."
    },
    ...
  ],
  "notes": "If fewer than 2 verbs at the user_cefr level are available, questions array will have fewer items."
}

**CRITICAL FINAL CHECKLIST BEFORE SUBMITTING:**
- [ ] Each question_de uses a phrase that appears EXACTLY in INPUT.occurrences (only the verb replaced with __[1]__)
- [ ] The correct_form matches the verb form that was in the original phrase from INPUT.occurrences
- [ ] The correct_form appears in the choices array at the correct_index
- [ ] All 5 choices are different forms of the same verb (the infinitive)
- [ ] No words were added, removed, or changed except the verb → __[1]__ replacement

Now process the provided INPUT JSON exactly and return the JSON described.`;
  }

  private async generateFillInTheBlanks(scaffold: any, userProfile: any, personalizationId: string, previouslyUsed: string[], mediaTranscript?: string): Promise<any[]> {
    console.log('=== GENERATING FILL-IN-THE-BLANKS ===');
    console.log('Using Personalization ID:', personalizationId);
    console.log('User Profile received:', {
      cefr: userProfile.cefr,
      purpose: userProfile.purpose,
    });
    console.log('Scaffold vocabulary count:', scaffold.vocabulary?.length || 0);
    console.log('Scaffold vocabulary usage examples:', scaffold.vocabulary?.slice(0, 3).map((v: any) => v.usageInTranscript?.substring(0, 50)));

    const level = (userProfile.cefr || 'B1').toUpperCase();
    const cefrBand =
      level.startsWith('A') ? 'A1-A2' :
      level.startsWith('B') ? 'B1-B2' :
      'C1-C2';

    const blanksCount =
      cefrBand === 'A1-A2' ? 1 :
      cefrBand === 'B1-B2' ? 2 :
      3; // C1-C2

    // Normalize user goal to canonical form
    const normalizedGoal = (userProfile.purpose || 'general').toLowerCase().trim();
    const canonicalGoal = ['vocabulary', 'reading', 'grammar', 'general'].includes(normalizedGoal) 
      ? normalizedGoal 
      : 'general';

    // Map "reading" to "comprehension" for prompt selection
    const promptGoal = canonicalGoal === 'reading' ? 'comprehension' : canonicalGoal;

    console.log('Fill-in-the-Blanks Generation Parameters:', {
      userCefr: userProfile.cefr,
      level: level,
      cefrBand: cefrBand,
      blanksCount: blanksCount,
      normalizedGoal: normalizedGoal,
      canonicalGoal: canonicalGoal,
      promptGoal: promptGoal,
    });

    // Note: Grammar goals now use analyze-and-classify endpoint (see grammar section below)

    // Select the appropriate prompt based on user goal
    let systemPrompt: string;
    let userPrompt: string;

    if (promptGoal === 'vocabulary') {
      // NEW VOCABULARY FLOW: Use analyze-and-classify endpoint
      console.log('SELECTED: Vocabulary fill-in-the-blanks - using analyze-and-classify endpoint');
      
      const transcript = mediaTranscript || scaffold.text || '';
      
      if (!transcript || transcript.trim().length === 0) {
        console.error('CRITICAL: No transcript available for vocabulary fill-in-the-blanks');
        return [];
      }
      
      try {
        // Call the combined analyze-and-classify endpoint
        const apiUrl = process.env.API_BASE_URL || 'http://localhost:3000/api';
        const endpoint = `${apiUrl}/text-analysis/analyze-and-classify`;
        
        console.log('Calling analyze-and-classify endpoint...');
        const response = await axios.post(endpoint, {
          transcript: transcript
        }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 60000, // 60 second timeout (longer since it does both operations)
        });
        
        const result = response.data;
        console.log(`analyze-and-classify returned: ${result.nouns?.length || 0} nouns, ${result.verbs?.length || 0} verbs, ${result.adjectives?.length || 0} adjectives`);
        console.log(`Classified ${result.classified?.length || 0} words by CEFR level`);
        
        // Filter words matching user's CEFR level (with ±1 level fallback)
        const userCefr = (userProfile.cefr || 'B1').toUpperCase();
        const cefrLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
        const userLevelIndex = cefrLevels.indexOf(userCefr);
        
        if (userLevelIndex === -1) {
          console.error(`Invalid CEFR level: ${userCefr}`);
          return [];
        }
        
        // Get words matching user's level
        let matchingWords = (result.classified || []).filter((w: any) => w.cefr === userCefr);
        console.log(`Found ${matchingWords.length} words matching CEFR level ${userCefr}`);
        
        // If insufficient, try ±1 level
        if (matchingWords.length < 2) {
          const fallbackLevels: string[] = [];
          if (userLevelIndex > 0) {
            fallbackLevels.push(cefrLevels[userLevelIndex - 1]); // One level below
          }
          if (userLevelIndex < cefrLevels.length - 1) {
            fallbackLevels.push(cefrLevels[userLevelIndex + 1]); // One level above
          }
          
          console.log(`Insufficient words at ${userCefr}, trying fallback levels: ${fallbackLevels.join(', ')}`);
          
          for (const fallbackLevel of fallbackLevels) {
            const fallbackWords = (result.classified || []).filter((w: any) => w.cefr === fallbackLevel);
            matchingWords = [...matchingWords, ...fallbackWords];
            console.log(`Added ${fallbackWords.length} words from ${fallbackLevel}`);
            
            if (matchingWords.length >= 2) {
              break;
            }
          }
        }
        
        // Final fallback: if still insufficient, use ANY words from classified list
        if (matchingWords.length < 2) {
          console.warn(`Still insufficient words (${matchingWords.length}), using ANY words from classified list as final fallback`);
          const allWords = result.classified || [];
          matchingWords = [...matchingWords, ...allWords];
          // Remove duplicates based on word+pos combination
          const seen = new Set<string>();
          matchingWords = matchingWords.filter((w: any) => {
            const key = `${w.word.toLowerCase()}_${w.pos}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          console.log(`Using ${matchingWords.length} total words (including fallback from all levels)`);
        }
        
        if (matchingWords.length === 0) {
          console.error('CRITICAL: No words available in classified list at all');
          return [];
        }
        
        // Create fill-in-the-blanks from occurrence sentences
        // Keep trying until we get 2 valid questions
        const vocabularyResult: any[] = [];
        const shuffled = [...matchingWords].sort(() => Math.random() - 0.5);
        const triedWords = new Set<string>();
        
        for (const word of shuffled) {
          if (vocabularyResult.length >= 2) {
            break; // We have enough questions
          }
          
          // Skip if we've already tried this word
          const wordKey = `${word.word.toLowerCase()}_${word.pos}`;
          if (triedWords.has(wordKey)) {
            continue;
          }
          triedWords.add(wordKey);
          
          let i = vocabularyResult.length;
          let occurrences: Array<{ phrase: string }> = [];
          
          // Normalize word for comparison (case-insensitive, as spacy returns lowercase lemmas)
          const normalizedWord = word.word.toLowerCase().trim();
          
          // Get occurrences based on POS (case-insensitive matching)
          if (word.pos === 'verb') {
            occurrences = (result.verb_occurrences || []).filter((occ: any) => 
              (occ.infinitive || '').toLowerCase().trim() === normalizedWord
            );
            console.log(`Looking for verb "${word.word}" (normalized: "${normalizedWord}")`);
            if (occurrences.length === 0 && result.verb_occurrences && result.verb_occurrences.length > 0) {
              const uniqueVerbs = [...new Set(result.verb_occurrences.map((o: any) => o.infinitive))];
              console.log(`Available verb infinitives (first 10): ${uniqueVerbs.slice(0, 10).join(', ')}`);
            }
          } else if (word.pos === 'noun') {
            occurrences = (result.noun_occurrences || []).filter((occ: any) => 
              (occ.noun || '').toLowerCase().trim() === normalizedWord
            );
            console.log(`Looking for noun "${word.word}" (normalized: "${normalizedWord}")`);
            if (occurrences.length === 0 && result.noun_occurrences && result.noun_occurrences.length > 0) {
              const uniqueNouns = [...new Set(result.noun_occurrences.map((o: any) => o.noun))];
              console.log(`Available noun lemmas (first 20): ${uniqueNouns.slice(0, 20).join(', ')}`);
              // Check if there's a close match
              const closeMatch = uniqueNouns.find((n: string) => n.toLowerCase().trim() === normalizedWord);
              if (closeMatch) {
                console.log(`Found close match: "${closeMatch}" (looking for "${normalizedWord}")`);
              }
            }
          } else if (word.pos === 'adjective') {
            occurrences = (result.adjective_occurrences || []).filter((occ: any) => 
              (occ.adjective || '').toLowerCase().trim() === normalizedWord
            );
            console.log(`Looking for adjective "${word.word}" (normalized: "${normalizedWord}")`);
            if (occurrences.length === 0 && result.adjective_occurrences && result.adjective_occurrences.length > 0) {
              const uniqueAdjs = [...new Set(result.adjective_occurrences.map((o: any) => o.adjective))];
              console.log(`Available adjective lemmas (first 10): ${uniqueAdjs.slice(0, 10).join(', ')}`);
            }
          }
          
          if (occurrences.length === 0) {
            console.warn(`No occurrences found for word "${word.word}" (${word.pos}, normalized: "${normalizedWord}"), skipping...`);
            continue;
          }
          
          console.log(`Found ${occurrences.length} occurrence(s) for word "${word.word}"`);
          
          // Try occurrences until we find one where we can locate the word
          let selectedOccurrence: any = null;
          let phrase: string = '';
          let wordInPhrase: string | undefined;
          
          // Shuffle occurrences to try different ones
          const shuffledOccurrences = [...occurrences].sort(() => Math.random() - 0.5);
          
          for (const occ of shuffledOccurrences) {
            phrase = occ.phrase;
            const phraseWords = phrase.split(/\s+/);
            
            // Try exact match first
            wordInPhrase = phraseWords.find((w: string) => {
              const cleanW = w.toLowerCase().replace(/[.,!?;:()\[\]{}"'`]/g, '');
              const cleanWord = word.word.toLowerCase();
              return cleanW === cleanWord;
            });
            
            // Try substring/prefix matching for inflected forms
            if (!wordInPhrase) {
              wordInPhrase = phraseWords.find((w: string) => {
                const cleanW = w.toLowerCase().replace(/[.,!?;:()\[\]{}"'`]/g, '');
                const cleanWord = word.word.toLowerCase();
                // Check if they share a significant prefix (at least 3 chars)
                const minLen = Math.min(cleanW.length, cleanWord.length);
                if (minLen >= 3) {
                  const sharedPrefix = cleanW.substring(0, 3) === cleanWord.substring(0, 3);
                  const lengthDiff = Math.abs(cleanW.length - cleanWord.length);
                  if (sharedPrefix && lengthDiff <= 4) {
                    return true;
                  }
                }
                return cleanW.includes(cleanWord) || cleanWord.includes(cleanW) ||
                       cleanW.startsWith(cleanWord) || cleanWord.startsWith(cleanW);
              });
            }
            
            // If we found the word, use this occurrence
            if (wordInPhrase) {
              selectedOccurrence = occ;
              console.log(`Found word "${wordInPhrase}" in phrase: "${phrase.substring(0, 60)}..."`);
              break;
            }
          }
          
          // If we couldn't find the word in any occurrence, skip this word
          if (!wordInPhrase || !selectedOccurrence) {
            console.warn(`Could not find word "${word.word}" (${word.pos}) in any of ${occurrences.length} occurrence(s), trying next word...`);
            continue;
          }
          
          // Create the blank sentence by replacing the word with __[1]__
          const blankSentence = phrase.replace(
            new RegExp(wordInPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
            '__[1]__'
          );
          
          // Get distractors from the word pool (same POS, excluding the correct word)
          const correctAnswer = wordInPhrase.replace(/[.,!?;:()\[\]{}"'`]/g, '').trim();
          const allWordsSamePos = (result.classified || []).filter((w: any) => 
            w.pos === word.pos && w.word !== word.word
          );
          
          // Shuffle and select 4 distractors
          const shuffledDistractors = [...allWordsSamePos].sort(() => Math.random() - 0.5);
          const distractorWords = shuffledDistractors.slice(0, 4).map((w: any) => w.word);
          
          // If we don't have enough distractors, pad with common German words
          while (distractorWords.length < 4) {
            if (word.pos === 'noun') {
              distractorWords.push(['Haus', 'Mann', 'Frau', 'Kind'][distractorWords.length] || 'Wort');
            } else if (word.pos === 'verb') {
              distractorWords.push(['gehen', 'kommen', 'sehen', 'machen'][distractorWords.length] || 'tun');
            } else {
              distractorWords.push(['gut', 'schön', 'groß', 'klein'][distractorWords.length] || 'neu');
            }
          }
          
          // Combine correct answer with distractors and shuffle
          const allChoices = [correctAnswer, ...distractorWords.slice(0, 4)];
          const shuffledChoices = [...allChoices].sort(() => Math.random() - 0.5);
          const correctIndex = shuffledChoices.indexOf(correctAnswer);
          
          // Create the fill-in item (matching existing format)
          vocabularyResult.push({
            id: `fb${i + 1}`,
            type: 'vocabulary',
            prompt_de: `Fülle die Lücke mit dem richtigen Wort aus.`,
            prompt_en_hidden: `Fill in the blank with the correct word.`,
            blank_sentence_de: blankSentence,
            blank_sentence_en_hidden: blankSentence,
            draggable_options_de: shuffledChoices,
            draggable_options_en_hidden: shuffledChoices.map(() => ''),
            correct_index: correctIndex,
            correct_indices: [correctIndex],
            word: word.word,
            pos: word.pos,
            cefr: word.cefr,
            original_phrase: phrase,
          });
        }
        
        console.log(`Generated ${vocabularyResult.length} vocabulary fill-in-the-blanks`);
        
        // Ensure we always have 2 questions - if not, log warning but return what we have
        if (vocabularyResult.length < 2) {
          console.warn(`WARNING: Only generated ${vocabularyResult.length} vocabulary fill-in-the-blanks (expected 2)`);
          console.warn(`Tried ${triedWords.size} unique words from ${matchingWords.length} available words`);
          if (vocabularyResult.length === 0) {
            console.error('CRITICAL: Failed to generate any vocabulary fill-in-the-blanks!');
            console.error('This may indicate an issue with word-occurrence matching or insufficient transcript content.');
          }
        } else {
          console.log(`✓ Successfully generated ${vocabularyResult.length} vocabulary fill-in-the-blanks`);
        }
        
        // Return early for vocabulary - skip LLM processing
        return vocabularyResult;
        
      } catch (error: any) {
        console.error('Error in vocabulary fill-in-the-blanks generation:', error);
        if (error.response) {
          console.error('API Error Response:', error.response.status, error.response.data);
        }
        return [];
      }
    } else if (promptGoal === 'grammar') {
      // NEW GRAMMAR FLOW: Use analyze-and-classify endpoint, select VERBS only
      console.log('SELECTED: Grammar fill-in-the-blanks - using analyze-and-classify endpoint (VERBS only)');
      
      const transcript = mediaTranscript || scaffold.text || '';
      
      if (!transcript || transcript.trim().length === 0) {
        console.error('CRITICAL: No transcript available for grammar fill-in-the-blanks');
        return [];
      }
      
      try {
        // Call the combined analyze-and-classify endpoint
        const apiUrl = process.env.API_BASE_URL || 'http://localhost:3000/api';
        const endpoint = `${apiUrl}/text-analysis/analyze-and-classify`;
        
        console.log('Calling analyze-and-classify endpoint for grammar...');
        const response = await axios.post(endpoint, {
          transcript: transcript
        }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 60000,
        });
        
        const result = response.data;
        console.log(`analyze-and-classify returned: ${result.nouns?.length || 0} nouns, ${result.verbs?.length || 0} verbs, ${result.adjectives?.length || 0} adjectives`);
        console.log(`Classified ${result.classified?.length || 0} words by CEFR level`);
        
        // Filter for VERBS ONLY matching user's CEFR level (with ±1 level fallback)
        const userCefr = (userProfile.cefr || 'B1').toUpperCase();
        const cefrLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
        const userLevelIndex = cefrLevels.indexOf(userCefr);
        
        if (userLevelIndex === -1) {
          console.error(`Invalid CEFR level: ${userCefr}`);
          return [];
        }
        
        // Get VERBS matching user's level
        let matchingVerbs = (result.classified || []).filter((w: any) => w.pos === 'verb' && w.cefr === userCefr);
        console.log(`Found ${matchingVerbs.length} VERBS matching CEFR level ${userCefr}`);
        
        // If insufficient, try ±1 level
        if (matchingVerbs.length < 2) {
          const fallbackLevels: string[] = [];
          if (userLevelIndex > 0) {
            fallbackLevels.push(cefrLevels[userLevelIndex - 1]); // One level below
          }
          if (userLevelIndex < cefrLevels.length - 1) {
            fallbackLevels.push(cefrLevels[userLevelIndex + 1]); // One level above
          }
          
          console.log(`Insufficient verbs at ${userCefr}, trying fallback levels: ${fallbackLevels.join(', ')}`);
          
          for (const fallbackLevel of fallbackLevels) {
            const fallbackVerbs = (result.classified || []).filter((w: any) => w.pos === 'verb' && w.cefr === fallbackLevel);
            matchingVerbs = [...matchingVerbs, ...fallbackVerbs];
            console.log(`Added ${fallbackVerbs.length} verbs from ${fallbackLevel}`);
            
            if (matchingVerbs.length >= 2) {
              break;
            }
          }
        }
        
        // Final fallback: if still insufficient, use ANY verbs from classified list
        if (matchingVerbs.length < 2) {
          console.warn(`Still insufficient verbs (${matchingVerbs.length}), using ANY verbs from classified list as final fallback`);
          const allVerbs = (result.classified || []).filter((w: any) => w.pos === 'verb');
          matchingVerbs = [...matchingVerbs, ...allVerbs];
          // Remove duplicates based on word
          const seen = new Set<string>();
          matchingVerbs = matchingVerbs.filter((w: any) => {
            const key = w.word.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          console.log(`Using ${matchingVerbs.length} total verbs (including fallback from all levels)`);
        }
        
        if (matchingVerbs.length === 0) {
          console.error('CRITICAL: No verbs available in classified list at all');
          return [];
        }
        
        // Select 2 random verbs with occurrences
        const grammarResult: any[] = [];
        const shuffled = [...matchingVerbs].sort(() => Math.random() - 0.5);
        const triedVerbs = new Set<string>();
        
        for (const verb of shuffled) {
          if (grammarResult.length >= 2) {
            break; // We have enough questions
          }
          
          // Skip if we've already tried this verb
          const verbKey = verb.word.toLowerCase();
          if (triedVerbs.has(verbKey)) {
            continue;
          }
          triedVerbs.add(verbKey);
          
          // Get occurrences for this verb
          const normalizedVerb = verb.word.toLowerCase().trim();
          const verbOccurrences = (result.verb_occurrences || []).filter((occ: any) => 
            (occ.infinitive || '').toLowerCase().trim() === normalizedVerb
          );
          
          if (verbOccurrences.length === 0) {
            console.warn(`No occurrences found for verb "${verb.word}", trying next verb...`);
            continue;
          }
          
          console.log(`Found ${verbOccurrences.length} occurrence(s) for verb "${verb.word}"`);
          
          // Select a random occurrence
          const selectedOccurrence = verbOccurrences[Math.floor(Math.random() * verbOccurrences.length)];
          const phrase = selectedOccurrence.phrase;
          
          // Find the verb form in the phrase
          const phraseWords = phrase.split(/\s+/);
          let verbInPhrase: string | undefined;
          
          // Try to find the verb form (could be conjugated, compound, etc.)
          // First try exact match
          verbInPhrase = phraseWords.find((w: string) => {
            const cleanW = w.toLowerCase().replace(/[.,!?;:()\[\]{}"'`]/g, '');
            const cleanVerb = verb.word.toLowerCase();
            return cleanW === cleanVerb;
          });
          
          // Try substring/prefix matching for inflected forms
          if (!verbInPhrase) {
            verbInPhrase = phraseWords.find((w: string) => {
              const cleanW = w.toLowerCase().replace(/[.,!?;:()\[\]{}"'`]/g, '');
              const cleanVerb = verb.word.toLowerCase();
              // Check if they share a significant prefix (at least 3 chars)
              const minLen = Math.min(cleanW.length, cleanVerb.length);
              if (minLen >= 3) {
                const sharedPrefix = cleanW.substring(0, 3) === cleanVerb.substring(0, 3);
                const lengthDiff = Math.abs(cleanW.length - cleanVerb.length);
                if (sharedPrefix && lengthDiff <= 4) {
                  return true;
                }
              }
              return cleanW.includes(cleanVerb) || cleanVerb.includes(cleanW) ||
                     cleanW.startsWith(cleanVerb) || cleanVerb.startsWith(cleanW);
            });
          }
          
          // If still not found, try compound verbs (auxiliary + participle)
          if (!verbInPhrase) {
            // Look for compound forms like "ist gekommen", "hat gemacht", etc.
            for (let i = 0; i < phraseWords.length - 1; i++) {
              const twoWords = `${phraseWords[i]} ${phraseWords[i + 1]}`.toLowerCase();
              const cleanTwoWords = twoWords.replace(/[.,!?;:()\[\]{}"'`]/g, '');
              if (cleanTwoWords.includes(verb.word.toLowerCase()) || 
                  phraseWords[i + 1]?.toLowerCase().replace(/[.,!?;:()\[\]{}"'`]/g, '').includes(verb.word.toLowerCase())) {
                verbInPhrase = `${phraseWords[i]} ${phraseWords[i + 1]}`;
                break;
              }
            }
          }
          
          if (!verbInPhrase) {
            console.warn(`Could not find verb "${verb.word}" in phrase "${phrase}", trying next verb...`);
            continue;
          }
          
          // Create the blank sentence by replacing the verb with __[1]__
          const blankSentence = phrase.replace(
            new RegExp(verbInPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
            '__[1]__'
          );
          
          // Get the correct answer (the verb form from the phrase)
          const correctAnswer = verbInPhrase.replace(/[.,!?;:()\[\]{}"'`]/g, '').trim();
          
          // Use LLM to generate distractors (different verb forms of the same verb)
          // Prepare data for LLM
          const verbData = {
            infinitive: verb.word,
            correct_form: correctAnswer,
            phrase: phrase,
            verb_cefr: verb.cefr
          };
          
          // Add to grammar result - we'll generate distractors with LLM later
          grammarResult.push({
            id: `fb${grammarResult.length + 1}`,
            type: 'grammar',
            infinitive: verb.word,
            verb_cefr: verb.cefr,
            question_de: blankSentence,
            question_en: blankSentence, // Will be translated by LLM
            correct_form: correctAnswer,
            original_phrase: phrase,
            verb_data: verbData
          });
        }
        
        console.log(`Selected ${grammarResult.length} verbs with occurrences for grammar fill-in-the-blanks`);
        
        if (grammarResult.length === 0) {
          console.error('CRITICAL: No verbs with occurrences found for grammar fill-in-the-blanks');
          return [];
        }
        
        // Now use LLM to generate distractors (different verb forms) for each question
        systemPrompt = `You are a precise German-language exercise generator. Follow instructions exactly. Output must be valid JSON only (no prose, no Markdown).`;
        
        // Build prompt for LLM to generate distractors
        const grammarPromptData = {
          user_cefr: userProfile.cefr,
          questions: grammarResult.map((q: any) => ({
            infinitive: q.infinitive,
            verb_cefr: q.verb_cefr,
            question_de: q.question_de,
            correct_form: q.correct_form,
            original_phrase: q.original_phrase
          }))
        };
        
        userPrompt = this.buildGrammarFillInPromptFromSelectedVerbs(userProfile.cefr, grammarPromptData.questions, previouslyUsed);
        
        // Continue with LLM processing to generate distractors
        if (!this.openai) {
          console.error('OpenAI API key is not configured for grammar fill-in-the-blanks generation.');
          return [];
        }

        const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';
        const completion = await this.openai.chat.completions.create({
          model: modelName,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.0,
        });

        const rawOutput = (completion.choices[0]?.message?.content || '').trim();
        let cleanedOutput = rawOutput;
        if (rawOutput.includes('```json')) {
          cleanedOutput = rawOutput.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        } else if (rawOutput.includes('```')) {
          cleanedOutput = rawOutput.replace(/```\n?/g, '').trim();
        }

        const parsed = JSON.parse(cleanedOutput);
        
        // Transform grammar questions to fill_items format
        if (parsed.questions && Array.isArray(parsed.questions)) {
          const transformedQuestions = parsed.questions
            .map((q: any, index: number) => {
              // CRITICAL: Use the original correct_form from grammarResult, not from LLM response
              // This ensures we use the exact verb form from the transcript
              const originalQuestion = grammarResult[index];
              if (!originalQuestion) {
                console.error(`Grammar question ${index + 1}: No original question data found`);
                return null;
              }
              
              const originalCorrectForm = originalQuestion.correct_form || '';
              if (!originalCorrectForm) {
                console.error(`Grammar question ${index + 1}: No correct_form in original question data`);
                return null;
              }
              
              let choices = q.choices || [];
              const questionDe = q.question_de || originalQuestion.question_de || '';
              const infinitive = q.infinitive || originalQuestion.infinitive || '';
              
              // Ensure question has exactly 1 blank
              if (!questionDe.includes('__[1]__')) {
                console.error(`Grammar question ${index + 1}: Missing blank placeholder __[1]__`);
                return null;
              }
              
              // CRITICAL: Verify that the original correct_form is in the choices
              // Use case-insensitive, trimmed comparison
              const normalizeForComparison = (str: string) => str.trim().toLowerCase();
              const normalizedCorrectForm = normalizeForComparison(originalCorrectForm);
              
              // Find the correct form in choices (case-insensitive)
              let correctFormIndex = choices.findIndex((c: string) => 
                normalizeForComparison(c) === normalizedCorrectForm
              );
              
              // If not found, try to find a close match (handles slight variations)
              if (correctFormIndex === -1) {
                console.warn(`Grammar question ${index + 1}: Original correct_form "${originalCorrectForm}" not found in LLM choices. Searching for close match...`);
                console.warn(`LLM choices:`, choices);
                
                // Try to find by substring match or similar
                correctFormIndex = choices.findIndex((c: string) => {
                  const normalized = normalizeForComparison(c);
                  return normalized === normalizedCorrectForm ||
                         normalized.includes(normalizedCorrectForm) ||
                         normalizedCorrectForm.includes(normalized);
                });
                
                // If still not found, add the original correct form to choices
                if (correctFormIndex === -1) {
                  console.warn(`Grammar question ${index + 1}: Adding original correct_form "${originalCorrectForm}" to choices`);
                  // Remove a distractor if we have 5, otherwise just add
                  if (choices.length >= 5) {
                    // Remove the last one (usually a distractor)
                    choices = choices.slice(0, 4);
                  }
                  choices.push(originalCorrectForm);
                  correctFormIndex = choices.length - 1;
                } else {
                  console.warn(`Grammar question ${index + 1}: Found close match at index ${correctFormIndex}: "${choices[correctFormIndex]}"`);
                  // Update the choice to use the exact original form
                  choices[correctFormIndex] = originalCorrectForm;
                }
              } else {
                // Found exact match - verify it's the exact form (case-sensitive for display)
                if (choices[correctFormIndex] !== originalCorrectForm) {
                  console.log(`Grammar question ${index + 1}: Updating choice at index ${correctFormIndex} to exact original form`);
                  choices[correctFormIndex] = originalCorrectForm;
                }
              }
              
              console.log(`Grammar question ${index + 1}: Using correct_form "${originalCorrectForm}" at index ${correctFormIndex}`);
              
              // Ensure all choices are unique (case-insensitive, trimmed)
              const normalizedChoices = choices.map((c: string) => c.trim().toLowerCase());
              const uniqueChoices = new Set(normalizedChoices);
              
              if (uniqueChoices.size !== choices.length) {
                console.warn(`Grammar question ${index + 1}: Found duplicate choices. Removing duplicates...`);
                // Remove duplicates while preserving order and case
                const seen = new Set<string>();
                const uniqueChoicesArray: string[] = [];
                
                choices.forEach((choice: string, idx: number) => {
                  const normalized = choice.trim().toLowerCase();
                  if (!seen.has(normalized)) {
                    seen.add(normalized);
                    uniqueChoicesArray.push(choice.trim());
                  }
                });
                
                // CRITICAL: Ensure the original correct form is in the unique choices
                const correctNormalized = normalizeForComparison(originalCorrectForm);
                if (!seen.has(correctNormalized)) {
                  uniqueChoicesArray.push(originalCorrectForm);
                  seen.add(correctNormalized);
                }
                
                // Find where correct answer is now (use original correct form)
                let newCorrectIndex = uniqueChoicesArray.findIndex(c => 
                  normalizeForComparison(c) === correctNormalized
                );
                
                if (newCorrectIndex === -1) {
                  console.error(`Grammar question ${index + 1}: Could not find correct form "${originalCorrectForm}" after deduplication`);
                  // Force add it
                  uniqueChoicesArray.push(originalCorrectForm);
                  newCorrectIndex = uniqueChoicesArray.length - 1;
                  console.warn(`Grammar question ${index + 1}: Forced correct form at index ${newCorrectIndex}`);
                }
                
                // If we have fewer than 5 unique choices, generate replacements
                if (uniqueChoicesArray.length < 2) {
                  console.error(`Grammar question ${index + 1}: Not enough unique choices after deduplication (${uniqueChoicesArray.length})`);
                  return null;
                }
                
                // Generate additional unique verb forms to replace duplicates and ensure exactly 5 choices
                const neededCount = 5 - uniqueChoicesArray.length;
                if (neededCount > 0) {
                  console.log(`Grammar question ${index + 1}: Generating ${neededCount} additional unique verb forms to replace duplicates...`);
                  const additionalForms = this.generateAdditionalVerbForms(infinitive, seen, neededCount);
                  
                  if (additionalForms.length < neededCount) {
                    console.warn(`Grammar question ${index + 1}: Could only generate ${additionalForms.length} additional forms (needed ${neededCount}). Will use ${uniqueChoicesArray.length + additionalForms.length} total choices.`);
                  }
                  
                  uniqueChoicesArray.push(...additionalForms);
                  
                  // If we still don't have 5, try one more time with more generic forms
                  while (uniqueChoicesArray.length < 5) {
                    const moreForms = this.generateAdditionalVerbForms(infinitive, seen, 5 - uniqueChoicesArray.length);
                    if (moreForms.length === 0) {
                      // Last resort: use variations of existing forms
                      const existingForm = uniqueChoicesArray[0];
                      const variations = [
                        existingForm + 'e',
                        existingForm + 'n',
                        'wird ' + infinitive,
                        'hat ' + existingForm,
                        'ist ' + existingForm
                      ];
                      for (const variation of variations) {
                        const normalized = variation.toLowerCase();
                        if (!seen.has(normalized) && uniqueChoicesArray.length < 5) {
                          uniqueChoicesArray.push(variation);
                          seen.add(normalized);
                        }
                      }
                      // If still not 5, break to avoid infinite loop
                      if (uniqueChoicesArray.length < 5) {
                        console.warn(`Grammar question ${index + 1}: Could not generate exactly 5 unique choices. Using ${uniqueChoicesArray.length} choices.`);
                        break;
                      }
                    } else {
                      uniqueChoicesArray.push(...moreForms);
                    }
                  }
                }
                
                // Randomize the position of the correct answer (use original correct form)
                const shuffledChoices = [...uniqueChoicesArray];
                const correctAnswer = originalCorrectForm; // Always use the original from transcript
                shuffledChoices.splice(newCorrectIndex, 1); // Remove correct answer from its current position
                
                // Shuffle remaining choices
                const shuffled = shuffledChoices.sort(() => Math.random() - 0.5);
                
                // Insert correct answer at random position
                const finalCorrectIndex = Math.floor(Math.random() * (shuffled.length + 1));
                shuffled.splice(finalCorrectIndex, 0, correctAnswer);
                
                console.log(`Grammar question ${index + 1}: Final correct_index=${finalCorrectIndex}, correct_form="${correctAnswer}"`);
                console.log(`Grammar question ${index + 1}: Final choices:`, shuffled);
                
                return {
                  id: `fb${index + 1}`,
                  type: 'grammar',
                  prompt_de: `Fülle die Lücke mit der richtigen Verbform aus.`,
                  prompt_en_hidden: `Fill in the blank with the correct verb form.`,
                  blank_sentence_de: questionDe,
                  blank_sentence_en_hidden: q.question_en || questionDe,
                  draggable_options_de: shuffled,
                  draggable_options_en_hidden: shuffled.map(() => ''),
                  correct_index: finalCorrectIndex,
                  correct_indices: [finalCorrectIndex],
                  brief_rationale: q.brief_rationale || '',
                  infinitive: infinitive,
                  verb_cefr: q.verb_cefr || '',
                  explanation_de: q.brief_rationale || 'Richtig! Sehr gut!',
                  explanation_en: q.brief_rationale || 'Correct! Very good!',
                  correct_form: correctAnswer, // Always the original from transcript
                };
              }
              
              // All choices are unique - randomize the position of correct answer (use original correct form)
              const shuffledChoices = [...choices];
              const correctAnswer = originalCorrectForm; // Always use the original from transcript
              shuffledChoices.splice(correctFormIndex, 1); // Remove correct answer from its current position
              
              // Shuffle remaining choices
              const shuffled = shuffledChoices.sort(() => Math.random() - 0.5);
              
              // Insert correct answer at random position
              const finalCorrectIndex = Math.floor(Math.random() * (shuffled.length + 1));
              shuffled.splice(finalCorrectIndex, 0, correctAnswer);
              
              console.log(`Grammar question ${index + 1}: Final correct_index=${finalCorrectIndex}, correct_form="${correctAnswer}"`);
              console.log(`Grammar question ${index + 1}: Final choices:`, shuffled);
              
              return {
                id: `fb${index + 1}`,
                type: 'grammar',
                prompt_de: `Fülle die Lücke mit der richtigen Verbform aus.`,
                prompt_en_hidden: `Fill in the blank with the correct verb form.`,
                blank_sentence_de: questionDe,
                blank_sentence_en_hidden: q.question_en || questionDe,
                draggable_options_de: shuffled,
                draggable_options_en_hidden: shuffled.map(() => ''),
                correct_index: finalCorrectIndex,
                correct_indices: [finalCorrectIndex],
                brief_rationale: q.brief_rationale || '',
                infinitive: infinitive,
                verb_cefr: q.verb_cefr || '',
                explanation_de: q.brief_rationale || 'Richtig! Sehr gut!',
                explanation_en: q.brief_rationale || 'Correct! Very good!',
                correct_form: correctAnswer, // Always the original from transcript
              };
            })
            .filter((item: any) => item !== null);
          
          console.log(`Generated ${transformedQuestions.length} grammar fill-in-the-blanks`);
          
          // Return early for grammar - skip old LLM processing
          return transformedQuestions;
        } else {
          console.error('Grammar fill-in-the-blanks: Expected "questions" array in response');
          return [];
        }
        
      } catch (error: any) {
        console.error('Error in grammar fill-in-the-blanks generation:', error);
        if (error.response) {
          console.error('API Error Response:', error.response.status, error.response.data);
        }
        return [];
      }
    } else {
      // General goal also uses the new vocabulary flow
      console.log('SELECTED: General (defaulting to vocabulary) fill-in-the-blanks - using analyze-and-classify endpoint');
      
      const transcript = mediaTranscript || scaffold.text || '';
      
      if (!transcript || transcript.trim().length === 0) {
        console.error('CRITICAL: No transcript available for vocabulary fill-in-the-blanks');
        return [];
      }
      
      try {
        // Call the combined analyze-and-classify endpoint
        const apiUrl = process.env.API_BASE_URL || 'http://localhost:3000/api';
        const endpoint = `${apiUrl}/text-analysis/analyze-and-classify`;
        
        console.log('Calling analyze-and-classify endpoint...');
        const response = await axios.post(endpoint, {
          transcript: transcript
        }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 60000,
        });
        
        const result = response.data;
        console.log(`analyze-and-classify returned: ${result.nouns?.length || 0} nouns, ${result.verbs?.length || 0} verbs, ${result.adjectives?.length || 0} adjectives`);
        console.log(`Classified ${result.classified?.length || 0} words by CEFR level`);
        
        // Filter words matching user's CEFR level (with ±1 level fallback)
        const userCefr = (userProfile.cefr || 'B1').toUpperCase();
        const cefrLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
        const userLevelIndex = cefrLevels.indexOf(userCefr);
        
        if (userLevelIndex === -1) {
          console.error(`Invalid CEFR level: ${userCefr}`);
          return [];
        }
        
        // Get words matching user's level
        let matchingWords = (result.classified || []).filter((w: any) => w.cefr === userCefr);
        console.log(`Found ${matchingWords.length} words matching CEFR level ${userCefr}`);
        
        // If insufficient, try ±1 level
        if (matchingWords.length < 2) {
          const fallbackLevels: string[] = [];
          if (userLevelIndex > 0) {
            fallbackLevels.push(cefrLevels[userLevelIndex - 1]);
          }
          if (userLevelIndex < cefrLevels.length - 1) {
            fallbackLevels.push(cefrLevels[userLevelIndex + 1]);
          }
          
          console.log(`Insufficient words at ${userCefr}, trying fallback levels: ${fallbackLevels.join(', ')}`);
          
          for (const fallbackLevel of fallbackLevels) {
            const fallbackWords = (result.classified || []).filter((w: any) => w.cefr === fallbackLevel);
            matchingWords = [...matchingWords, ...fallbackWords];
            console.log(`Added ${fallbackWords.length} words from ${fallbackLevel}`);
            
            if (matchingWords.length >= 2) {
              break;
            }
          }
        }
        
        // Final fallback: if still insufficient, use ANY words from classified list
        if (matchingWords.length < 2) {
          console.warn(`Still insufficient words (${matchingWords.length}), using ANY words from classified list as final fallback`);
          const allWords = result.classified || [];
          matchingWords = [...matchingWords, ...allWords];
          // Remove duplicates based on word+pos combination
          const seen = new Set<string>();
          matchingWords = matchingWords.filter((w: any) => {
            const key = `${w.word.toLowerCase()}_${w.pos}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          console.log(`Using ${matchingWords.length} total words (including fallback from all levels)`);
        }
        
        if (matchingWords.length === 0) {
          console.error('CRITICAL: No words available in classified list at all');
          return [];
        }
        
        // Create fill-in-the-blanks from occurrence sentences
        // Keep trying until we get 2 valid questions
        const vocabularyResult: any[] = [];
        const shuffled = [...matchingWords].sort(() => Math.random() - 0.5);
        const triedWords = new Set<string>();
        
        for (const word of shuffled) {
          if (vocabularyResult.length >= 2) {
            break; // We have enough questions
          }
          
          // Skip if we've already tried this word
          const wordKey = `${word.word.toLowerCase()}_${word.pos}`;
          if (triedWords.has(wordKey)) {
            continue;
          }
          triedWords.add(wordKey);
          
          let i = vocabularyResult.length;
          let occurrences: Array<{ phrase: string }> = [];
          
          // Normalize word for comparison (case-insensitive, as spacy returns lowercase lemmas)
          const normalizedWord = word.word.toLowerCase().trim();
          
          // Get occurrences based on POS (case-insensitive matching)
          if (word.pos === 'verb') {
            occurrences = (result.verb_occurrences || []).filter((occ: any) => 
              (occ.infinitive || '').toLowerCase().trim() === normalizedWord
            );
            console.log(`Looking for verb "${word.word}" (normalized: "${normalizedWord}")`);
            if (occurrences.length === 0 && result.verb_occurrences && result.verb_occurrences.length > 0) {
              const uniqueVerbs = [...new Set(result.verb_occurrences.map((o: any) => o.infinitive))];
              console.log(`Available verb infinitives (first 10): ${uniqueVerbs.slice(0, 10).join(', ')}`);
            }
          } else if (word.pos === 'noun') {
            occurrences = (result.noun_occurrences || []).filter((occ: any) => 
              (occ.noun || '').toLowerCase().trim() === normalizedWord
            );
            console.log(`Looking for noun "${word.word}" (normalized: "${normalizedWord}")`);
            if (occurrences.length === 0 && result.noun_occurrences && result.noun_occurrences.length > 0) {
              const uniqueNouns = [...new Set(result.noun_occurrences.map((o: any) => o.noun))];
              console.log(`Available noun lemmas (first 20): ${uniqueNouns.slice(0, 20).join(', ')}`);
              // Check if there's a close match
              const closeMatch = uniqueNouns.find((n: string) => n.toLowerCase().trim() === normalizedWord);
              if (closeMatch) {
                console.log(`Found close match: "${closeMatch}" (looking for "${normalizedWord}")`);
              }
            }
          } else if (word.pos === 'adjective') {
            occurrences = (result.adjective_occurrences || []).filter((occ: any) => 
              (occ.adjective || '').toLowerCase().trim() === normalizedWord
            );
            console.log(`Looking for adjective "${word.word}" (normalized: "${normalizedWord}")`);
            if (occurrences.length === 0 && result.adjective_occurrences && result.adjective_occurrences.length > 0) {
              const uniqueAdjs = [...new Set(result.adjective_occurrences.map((o: any) => o.adjective))];
              console.log(`Available adjective lemmas (first 10): ${uniqueAdjs.slice(0, 10).join(', ')}`);
            }
          }
          
          if (occurrences.length === 0) {
            console.warn(`No occurrences found for word "${word.word}" (${word.pos}, normalized: "${normalizedWord}"), skipping...`);
            continue;
          }
          
          console.log(`Found ${occurrences.length} occurrence(s) for word "${word.word}"`);
          
          // Try occurrences until we find one where we can locate the word
          let selectedOccurrence: any = null;
          let phrase: string = '';
          let wordInPhrase: string | undefined;
          
          // Shuffle occurrences to try different ones
          const shuffledOccurrences = [...occurrences].sort(() => Math.random() - 0.5);
          
          for (const occ of shuffledOccurrences) {
            phrase = occ.phrase;
            const phraseWords = phrase.split(/\s+/);
            
            // Try exact match first
            wordInPhrase = phraseWords.find((w: string) => {
              const cleanW = w.toLowerCase().replace(/[.,!?;:()\[\]{}"'`]/g, '');
              const cleanWord = word.word.toLowerCase();
              return cleanW === cleanWord;
            });
            
            // Try substring/prefix matching for inflected forms
            if (!wordInPhrase) {
              wordInPhrase = phraseWords.find((w: string) => {
                const cleanW = w.toLowerCase().replace(/[.,!?;:()\[\]{}"'`]/g, '');
                const cleanWord = word.word.toLowerCase();
                // Check if they share a significant prefix (at least 3 chars)
                const minLen = Math.min(cleanW.length, cleanWord.length);
                if (minLen >= 3) {
                  const sharedPrefix = cleanW.substring(0, 3) === cleanWord.substring(0, 3);
                  const lengthDiff = Math.abs(cleanW.length - cleanWord.length);
                  if (sharedPrefix && lengthDiff <= 4) {
                    return true;
                  }
                }
                return cleanW.includes(cleanWord) || cleanWord.includes(cleanW) ||
                       cleanW.startsWith(cleanWord) || cleanWord.startsWith(cleanW);
              });
            }
            
            // If we found the word, use this occurrence
            if (wordInPhrase) {
              selectedOccurrence = occ;
              console.log(`Found word "${wordInPhrase}" in phrase: "${phrase.substring(0, 60)}..."`);
              break;
            }
          }
          
          // If we couldn't find the word in any occurrence, skip this word
          if (!wordInPhrase || !selectedOccurrence) {
            console.warn(`Could not find word "${word.word}" (${word.pos}) in any of ${occurrences.length} occurrence(s), trying next word...`);
            continue;
          }
          
          // Create the blank sentence by replacing the word with __[1]__
          const blankSentence = phrase.replace(
            new RegExp(wordInPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
            '__[1]__'
          );
          
          // Get distractors from the word pool (same POS, excluding the correct word)
          const correctAnswer = wordInPhrase.replace(/[.,!?;:()\[\]{}"'`]/g, '').trim();
          const allWordsSamePos = (result.classified || []).filter((w: any) => 
            w.pos === word.pos && w.word !== word.word
          );
          
          // Shuffle and select 4 distractors
          const shuffledDistractors = [...allWordsSamePos].sort(() => Math.random() - 0.5);
          const distractorWords = shuffledDistractors.slice(0, 4).map((w: any) => w.word);
          
          // If we don't have enough distractors, pad with common German words
          while (distractorWords.length < 4) {
            if (word.pos === 'noun') {
              distractorWords.push(['Haus', 'Mann', 'Frau', 'Kind'][distractorWords.length] || 'Wort');
            } else if (word.pos === 'verb') {
              distractorWords.push(['gehen', 'kommen', 'sehen', 'machen'][distractorWords.length] || 'tun');
            } else {
              distractorWords.push(['gut', 'schön', 'groß', 'klein'][distractorWords.length] || 'neu');
            }
          }
          
          // Combine correct answer with distractors and shuffle
          const allChoices = [correctAnswer, ...distractorWords.slice(0, 4)];
          const shuffledChoices = [...allChoices].sort(() => Math.random() - 0.5);
          const correctIndex = shuffledChoices.indexOf(correctAnswer);
          
          // Create the fill-in item (matching existing format)
          vocabularyResult.push({
            id: `fb${i + 1}`,
            type: 'vocabulary',
            prompt_de: `Fülle die Lücke mit dem richtigen Wort aus.`,
            prompt_en_hidden: `Fill in the blank with the correct word.`,
            blank_sentence_de: blankSentence,
            blank_sentence_en_hidden: blankSentence,
            draggable_options_de: shuffledChoices,
            draggable_options_en_hidden: shuffledChoices.map(() => ''),
            correct_index: correctIndex,
            correct_indices: [correctIndex],
            word: word.word,
            pos: word.pos,
            cefr: word.cefr,
            original_phrase: phrase,
          });
        }
        
        console.log(`Generated ${vocabularyResult.length} vocabulary fill-in-the-blanks`);
        
        // Ensure we always have 2 questions - if not, log warning but return what we have
        if (vocabularyResult.length < 2) {
          console.warn(`WARNING: Only generated ${vocabularyResult.length} vocabulary fill-in-the-blanks (expected 2)`);
          console.warn(`Tried ${triedWords.size} unique words from ${matchingWords.length} available words`);
          if (vocabularyResult.length === 0) {
            console.error('CRITICAL: Failed to generate any vocabulary fill-in-the-blanks!');
            console.error('This may indicate an issue with word-occurrence matching or insufficient transcript content.');
          }
        } else {
          console.log(`✓ Successfully generated ${vocabularyResult.length} vocabulary fill-in-the-blanks`);
        }
        
        // Return early for vocabulary - skip LLM processing
        return vocabularyResult;
        
      } catch (error: any) {
        console.error('Error in vocabulary fill-in-the-blanks generation:', error);
        if (error.response) {
          console.error('API Error Response:', error.response.status, error.response.data);
        }
        return [];
      }
    }

    try {
      // Use OpenAI for evaluation generation (fill-in-the-blanks)
      if (!this.openai) {
        console.error('OpenAI API key is not configured for fill-in-the-blanks generation.');
        return [];
      }

      const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const completion = await this.openai.chat.completions.create({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
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
      
      // Log LLM response for debugging
      if (promptGoal === 'grammar') {
        console.log('=== LLM RESPONSE FOR GRAMMAR FILL-IN ===');
        console.log('Parsed response:', JSON.stringify(parsed, null, 2));
        if (parsed.questions) {
          console.log(`LLM generated ${parsed.questions.length} questions`);
          parsed.questions.forEach((q: any, idx: number) => {
            console.log(`Question ${idx + 1}:`, {
              infinitive: q.infinitive,
              verb_cefr: q.verb_cefr,
              question_de: q.question_de,
              correct_index: q.correct_index,
              correct_form: q.correct_form,
              choices: q.choices
            });
          });
        }
      }
      
      // Handle different response formats
      let result: any[] = [];
      
      if (promptGoal === 'grammar') {
        // Grammar questions are now handled in the grammar section above and return early
        // This code path should not be reached, but kept for safety
        console.warn('Grammar questions should have been processed earlier - this code path should not execute');
        result = [];
      } else {
        // Vocabulary/other formats: use existing format
        result = Array.isArray(parsed) ? parsed : parsed.fill_items || parsed.fillInTheBlanks || [];
      }
      
      if (result.length === 0) {
        console.error('No fill-in-the-blanks generated. Raw output:', cleanedOutput.substring(0, 500));
      } else {
        console.log(`Generated ${result.length} fill-in-the-blanks`);
      }

      // Validate that all fill-ins match the expected type
      const expectedType = promptGoal === 'vocabulary' ? 'vocabulary' : 
                          promptGoal === 'grammar' ? 'grammar' : 'vocabulary';
      
      const invalidFillIns = result.filter((item: any) => item.type && item.type !== expectedType);
      if (invalidFillIns.length > 0) {
        console.error(`TYPE MISMATCH ERROR: Expected type "${expectedType}" but found:`, 
          invalidFillIns.map((f: any) => ({ id: f.id, type: f.type })));
        // Filter out invalid fill-ins if type mismatch occurs
        const validFillIns = result.filter((item: any) => !item.type || item.type === expectedType);
        if (validFillIns.length === 0) {
          console.error('CRITICAL: No valid fill-ins after filtering. This indicates a prompt issue.');
          throw new InternalServerErrorException(`Failed to generate ${expectedType} fill-in-the-blanks. LLM returned incorrect types.`);
        }
        console.warn(`Filtered out ${invalidFillIns.length} invalid fill-ins. Returning ${validFillIns.length} valid fill-ins.`);
        return validFillIns;
      }

      console.log(`Successfully generated ${result.length} ${expectedType} fill-in-the-blanks`);
      
      return result;
    } catch (err: any) {
      console.error('Error generating fill-in-the-blanks:', err);
      const errorOutput = err?.response?.data || err?.message || 'No output';
      console.error('Raw output that failed:', typeof errorOutput === 'string' ? errorOutput.substring(0, 500) : JSON.stringify(errorOutput).substring(0, 500));
      throw err;
    }
  }

  private async generateShortAnswerQuestions(scaffold: any, userProfile: any, personalizationId: string, previouslyUsed: string[]): Promise<any[]> {
    console.log('=== GENERATING SHORT ANSWER QUESTIONS ===');
    console.log('Using Personalization ID:', personalizationId);
    console.log('User Profile received:', {
      cefr: userProfile.cefr,
      purpose: userProfile.purpose,
    });

    const systemPrompt = `You are a JSON-only generator. Temperature 0.0. Return ONLY the JSON specified below.`;
    const userPrompt = this.buildComprehensionShortAnswerPrompt(userProfile.cefr, scaffold, previouslyUsed);

    try {
      // Use OpenAI for evaluation generation (short answer questions)
      if (!this.openai) {
        console.error('OpenAI API key is not configured for short answer questions generation.');
        return [];
      }

      const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const completion = await this.openai.chat.completions.create({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
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
      const result = Array.isArray(parsed) ? parsed : parsed.short_answer_items || [];
      
      if (result.length === 0) {
        console.error('No short answer questions generated. Raw output:', cleanedOutput.substring(0, 500));
      } else {
        console.log(`Generated ${result.length} short answer questions`);
      }

      // Validate that all items match the expected type
      const invalidItems = result.filter((item: any) => item.type && item.type !== 'comprehension');
      if (invalidItems.length > 0) {
        console.error(`TYPE MISMATCH ERROR: Expected type "comprehension" but found:`, 
          invalidItems.map((f: any) => ({ id: f.id, type: f.type })));
        // Filter out invalid items if type mismatch occurs
        const validItems = result.filter((item: any) => !item.type || item.type === 'comprehension');
        if (validItems.length === 0) {
          console.error('CRITICAL: No valid short answer questions after filtering. This indicates a prompt issue.');
          throw new InternalServerErrorException(`Failed to generate comprehension short answer questions. LLM returned incorrect types.`);
        }
        console.warn(`Filtered out ${invalidItems.length} invalid items. Returning ${validItems.length} valid items.`);
        return validItems;
      }

      console.log(`Successfully generated ${result.length} comprehension short answer questions`);
      
      return result;
    } catch (err: any) {
      console.error('Error generating short answer questions:', err);
      const errorOutput = err?.response?.data || err?.message || 'No output';
      console.error('Raw output that failed:', typeof errorOutput === 'string' ? errorOutput.substring(0, 500) : JSON.stringify(errorOutput).substring(0, 500));
      throw err;
    }
  }
}
