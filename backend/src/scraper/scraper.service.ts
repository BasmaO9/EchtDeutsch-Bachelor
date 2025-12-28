import { Injectable, BadRequestException } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { GoogleGenAI } from '@google/genai';
import { TranscriptService } from '../transcript/transcript.service';
import { Innertube } from 'youtubei.js';

/**
 * Service for scraping German news websites and YouTube videos
 * Supports Nachrichtenleicht, Deutsche Welle (DW), and YouTube videos
 */
@Injectable()
export class ScraperService {
  private readonly USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  private genAI: GoogleGenAI | null = null;

  constructor(private readonly transcriptService: TranscriptService) {
    // Initialize Gemini for language validation if API key is available
    if (process.env.GEMINI_LLM) {
      try {
        this.genAI = new GoogleGenAI({
          apiKey: process.env.GEMINI_LLM,
        });
      } catch (error) {
        console.warn('Failed to initialize Gemini for language validation:', error);
      }
    }
  }

  /**
   * Sanitizes text by removing control characters and escaping special characters
   */
  private sanitize(text: string): string {
    if (!text) return '';

    return text
      .replace(/[\x00-\x1f\x7f]/g, ' ') // remove control chars
      .replace(/\\/g, '\\\\') // escape backslashes
      .replace(/"""/g, '\\"""') // escape triple quotes
      .trim();
  }

  /**
   * Extracts the image URL from a parsed Nachrichtenleicht HTML
   * @param $ - Cheerio root instance with loaded HTML
   * @returns The image URL or null if not found
   */
  private extractNachrichtenleichtImage($: cheerio.Root): string | null {
    // 1️⃣ Best source: Open Graph image
    const ogImage = $('meta[property="og:image"]');
    if (ogImage.length > 0) {
      const content = ogImage.attr('content');
      if (content) {
        return content;
      }
    }

    // 2️⃣ Fallback: article <img> tag
    const img = $('figure img.internal-image');
    if (img.length > 0) {
      const src = img.attr('src');
      if (src) {
        return src;
      }
    }

    return null;
  }

  /**
   * Extracts the main image URL from a parsed DW HTML
   * @param $ - Cheerio root instance with loaded HTML
   * @returns The image URL or null if not found
   */
  private extractDWImage($: cheerio.Root): string | null {
    // 1️⃣ Find the first figure (main article image)
    const figure = $('figure').first();
    if (figure.length === 0) {
      return null;
    }

    const img = figure.find('img').first();
    if (img.length === 0) {
      return null;
    }

    const srcset = img.attr('srcset');
    if (!srcset) {
      return null;
    }

    // 2️⃣ Parse srcset entries
    // Example: "url1 78w, url2 201w, url3 1199w"
    const candidates: Array<{ width: number; url: string }> = [];

    for (const item of srcset.split(',')) {
      const parts = item.trim().split(/\s+/);
      if (parts.length !== 2) {
        continue;
      }

      const urlPart = parts[0];
      const sizePart = parts[1];

      // Filter for .jpg URLs
      if (!urlPart.endsWith('.jpg')) {
        continue;
      }

      // Extract width from size part (e.g., "78w" -> 78)
      const sizeMatch = sizePart.match(/(\d+)w/);
      if (sizeMatch) {
        const width = parseInt(sizeMatch[1], 10);
        candidates.push({ width, url: urlPart });
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // 3️⃣ Return the largest image
    candidates.sort((a, b) => b.width - a.width);
    return candidates[0].url;
  }

  /**
   * Scrapes a Nachrichtenleicht article
   * @param url - The URL of the Nachrichtenleicht article
   * @returns Scraped article data
   */
  async scrapeNachrichtenleicht(url: string) {
    if (!url.includes('nachrichtenleicht.de')) {
      throw new BadRequestException('Invalid Nachrichtenleicht URL');
    }

    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.USER_AGENT,
        },
      });

      const $ = cheerio.load(response.data);

      // Extract image URL from the already-loaded HTML
      const imageUrl = this.extractNachrichtenleichtImage($);

      const data: any = {
        source: 'Nachrichtenleicht',
        url,
        title: null,
        category: null,
        date_published: null,
        text: '',
        word_count: 0,
        vocabulary: [],
        imageUrl: imageUrl || null,
        debug: {},
      };

      // -------------------------------
      // TITLE
      // -------------------------------
      const title = $('h1 span.headline-title').text().trim();
      if (title) data.title = this.sanitize(title);

      // -------------------------------
      // DATE
      // -------------------------------
      const date = $('time').text().trim();
      if (date) data.date_published = this.sanitize(date);

      // -------------------------------
      // ARTICLE TEXT
      // -------------------------------
      const selectors = [
        '.article-header-description',
        '.article-details-text',
        '.b-article-extended-emphasis p',
      ];

      const paragraphs: string[] = [];

      selectors.forEach((sel) => {
        $(sel).each((_, el) => {
          const txt = $(el).text().trim();
          if (txt) paragraphs.push(this.sanitize(txt));
        });
      });

      const fullText = paragraphs.join('\n\n');
      data.text = fullText;
      data.word_count = fullText.split(/\s+/).length;

      // -------------------------------
      // VOCABULARY
      // -------------------------------
      const vocabList: any[] = [];

      $('.b-article-words-box .b-teaser-word').each((_, el) => {
        const word = $(el).find('.teaser-word-title').text().trim();
        const desc = $(el).find('.teaser-word-description').text().trim();

        if (word && desc) {
          vocabList.push({
            word: this.sanitize(word),
            definition: this.sanitize(desc),
          });
        }
      });

      data.vocabulary = vocabList;

      // -------------------------------
      // DEBUG INFO
      // -------------------------------
      data.debug = {
        matched_selector: 'article',
        raw_html_len: response.data.length,
        title_found: !!data.title,
        time_found: !!data.date_published,
        vocab_found: vocabList.length > 0,
      };

      return data;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to scrape Nachrichtenleicht article: ${error.message}`);
    }
  }

  /**
   * Scrapes a Deutsche Welle (DW) article
   * @param url - The URL of the DW article
   * @returns Scraped article data
   */
  async scrapeDW(url: string) {
    if (!url.includes('dw.com')) {
      throw new BadRequestException('Invalid DW URL');
    }

    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.USER_AGENT,
        },
      });

      const $ = cheerio.load(response.data);

      // Extract image URL from the already-loaded HTML
      const imageUrl = this.extractDWImage($);

      const data: any = {
        source: 'DW',
        url,
        title: null,
        date_published: null,
        text: null,
        word_count: 0,
        imageUrl: imageUrl || null,
        debug: {},
      };

      // -------------------------------
      // TITLE
      // -------------------------------
      const title = $('h1').text().trim();
      if (title) data.title = this.sanitize(title);

      // -------------------------------
      // DATE
      // -------------------------------
      const timeTag = $('time');
      if (timeTag && timeTag.attr('datetime')) {
        data.date_published = timeTag.attr('datetime');
      }

      // -------------------------------
      // ARTICLE CONTAINER SELECTORS
      // -------------------------------
      const selectors = [
        'div[itemprop="articleBody"]',
        'div[class*="richtext"]',
        'article',
        'section[aria-labelledby]',
      ];

      let container: cheerio.Cheerio | null = null;

      for (const sel of selectors) {
        const found = $(sel).first();
        if (found.length) {
          container = found;
          data.debug.matched_selector = sel;
          break;
        }
      }

      // Fallback: div with many <p>
      if (!container) {
        $('div').each((_, el) => {
          const pCount = $(el).find('p').length;
          if (pCount >= 3) {
            container = $(el);
            data.debug.matched_selector = 'heuristic div many <p>';
            return false;
          }
        });
      }

      if (!container) {
        data.debug.matched_selector = 'fallback all p';
      }

      // -------------------------------
      // EXTRACT PARAGRAPHS AND SUBTITLES
      // -------------------------------
      const elements: string[] = [];

      if (container) {
        container.find('p, h2, h3, h4').each((_, el) => {
          const text = $(el).text().trim();
          if (text) elements.push(text);
        });
      } else {
        $('p').each((_, el) => {
          const text = $(el).text().trim();
          if (text) elements.push(text);
        });
      }

      const fullText = this.sanitize(elements.join('\n\n'));
      data.text = fullText;
      data.word_count = fullText.split(/\s+/).length;

      return data;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to scrape DW article: ${error.message}`);
    }
  }

  /**
   * Extracts YouTube video ID from any YouTube URL format
   */
  extractYouTubeId(url: string): string {
    const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!match) {
      throw new BadRequestException('Invalid YouTube URL. Please provide a valid YouTube video URL.');
    }
    return match[1];
  }



  /**
   * Validates that transcript text is in German using Gemini
   */
  /**
   * Quick check for common German words/characters as a fallback
   */
  private hasGermanIndicators(text: string): boolean {
    const germanWords = ['der', 'die', 'das', 'und', 'ist', 'sind', 'haben', 'werden', 'können', 'müssen', 'wird', 'für', 'mit', 'auf', 'von', 'zu', 'nach', 'über', 'unter', 'durch', 'bei', 'seit', 'bis', 'gegen', 'ohne', 'um', 'vor', 'hinter', 'neben', 'zwischen'];
    const germanChars = ['ä', 'ö', 'ü', 'ß', 'Ä', 'Ö', 'Ü'];
    const lowerText = text.toLowerCase();
    
    // Check for German characters
    const hasGermanChars = germanChars.some(char => text.includes(char));
    
    // Check for common German words (need at least 3 matches)
    const germanWordMatches = germanWords.filter(word => lowerText.includes(' ' + word + ' ') || lowerText.startsWith(word + ' ') || lowerText.endsWith(' ' + word)).length;
    
    return hasGermanChars || germanWordMatches >= 3;
  }

  private async validateGermanLanguage(text: string): Promise<{ isGerman: boolean; confidence?: number; message?: string }> {
    if (!this.genAI) {
      // If Gemini is not available, use simple word check
      const hasGerman = this.hasGermanIndicators(text);
      return { isGerman: hasGerman, message: hasGerman ? 'Language validation skipped (using fallback check)' : 'Language validation skipped (Gemini not available)' };
    }

    try {
      // Use a larger sample and also sample from middle/end for better accuracy
      const textLength = text.length;
      let sampleText = '';
      
      if (textLength <= 1000) {
        // If text is short, use all of it
        sampleText = text;
      } else {
        // Use first 800 chars, middle 400 chars, and last 300 chars
        const firstPart = text.substring(0, 800);
        const middleStart = Math.floor(textLength / 2) - 200;
        const middlePart = text.substring(middleStart, middleStart + 400);
        const lastPart = text.substring(textLength - 300);
        sampleText = `${firstPart}\n\n[...middle section...]\n\n${middlePart}\n\n[...end section...]\n\n${lastPart}`;
      }

      const prompt = `You are a language detection expert. Analyze the following text and determine if it is written in German (Deutsch).

IMPORTANT CRITERIA:
- German uses umlauts (ä, ö, ü) and ß
- German has characteristic words like "der", "die", "das", "und", "ist", "sind", "haben", "werden", "können", "müssen"
- German sentence structure follows German grammar rules
- Look for German-specific vocabulary and expressions
- Consider that the text might be a transcript with some transcription errors

Respond with ONLY a valid JSON object in this exact format (no markdown, no code blocks, just JSON):
{
  "isGerman": true or false,
  "confidence": 0.0 to 1.0,
  "detectedLanguage": "language name if not German",
  "reason": "brief explanation"
}

Text to analyze:
${sampleText}`;

      const response = await this.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      const rawOutput = (response.text || '').trim();
      let cleanedOutput = rawOutput;
      
      // Remove markdown code blocks if present
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

      const parsed = JSON.parse(cleanedOutput);
      
      // Log for debugging
      console.log('Language validation result:', {
        isGerman: parsed.isGerman,
        confidence: parsed.confidence,
        detectedLanguage: parsed.detectedLanguage,
        reason: parsed.reason,
        sampleLength: sampleText.length,
      });

      // If confidence is very low (< 0.3), be more lenient
      let confidence = parsed.confidence || 0.5;
      let isGerman = parsed.isGerman === true;
      
      // Fallback: if LLM says not German but we detect German indicators, trust the indicators
      if (!isGerman && this.hasGermanIndicators(text)) {
        console.warn('LLM said not German, but German indicators found. Overriding to German.');
        isGerman = true;
        confidence = Math.max(confidence, 0.6); // Boost confidence
      }
      
      // If confidence is very low and not clearly English, be lenient
      if (!isGerman && confidence < 0.4 && parsed.detectedLanguage?.toLowerCase() !== 'english') {
        isGerman = true;
      }
      
      return {
        isGerman,
        confidence,
        message: parsed.reason || (isGerman ? 'Text is in German' : `Text appears to be in ${parsed.detectedLanguage || 'another language'}`),
      };
    } catch (error) {
      console.error('Error validating German language:', error);
      console.error('Raw response that failed:', error);
      // If validation fails, allow it but warn
      return { isGerman: true, message: 'Language validation failed, proceeding anyway' };
    }
  }

  /**
   * Scrapes a YouTube video transcript using transcriptapi.com
   * @param url - The URL of the YouTube video
   * @returns Scraped video data with transcript
   */
  async scrapeYouTube(url: string) {
    const videoId = this.extractYouTubeId(url);

    try {
      // Fetch transcript and metadata from transcript API
      const transcriptData = await this.transcriptService.getTranscript(url, {
        format: 'json',
        includeTimestamp: true,
        sendMetadata: true, // Get metadata including duration
      });

      // Extract transcript text from the response
      // The API may return transcript in different formats
      let transcriptText = '';
      
      if (transcriptData.transcript) {
        if (Array.isArray(transcriptData.transcript)) {
          // If transcript is an array of segments with text property
          transcriptText = transcriptData.transcript
            .map((segment: any) => {
              if (typeof segment === 'string') return segment;
              return segment.text || segment.transcript || '';
            })
            .filter((text: string) => text && text.trim())
            .join(' ')
            .trim();
        } else if (typeof transcriptData.transcript === 'string') {
          // If transcript is already a string
          transcriptText = transcriptData.transcript.trim();
        }
      } else if (transcriptData.text) {
        // Alternative field name
        transcriptText = typeof transcriptData.text === 'string' 
          ? transcriptData.text.trim()
          : '';
      } else if (Array.isArray(transcriptData)) {
        // If the response itself is an array
        transcriptText = transcriptData
          .map((segment: any) => {
            if (typeof segment === 'string') return segment;
            return segment.text || segment.transcript || '';
          })
          .filter((text: string) => text && text.trim())
          .join(' ')
          .trim();
      }

      if (!transcriptText || transcriptText.length === 0) {
        throw new BadRequestException('No transcript available for this video. The video may not have captions enabled.');
      }

      // Extract metadata from API response
      const metadata = transcriptData.metadata || {};
      const title = metadata.title || transcriptData.title || 'Untitled Video';
      
      // Try to extract duration from multiple possible fields and formats
      let duration: number = 0;
      
      // Try metadata.duration first
      if (metadata.duration) {
        if (typeof metadata.duration === 'number') {
          duration = metadata.duration;
        } else if (typeof metadata.duration === 'string') {
          // Try to parse if it's a string (could be ISO 8601 format like "PT15M30S" or just a number string)
          const parsed = parseFloat(metadata.duration);
          if (!isNaN(parsed)) {
            duration = parsed;
          }
        }
      }
      
      // Try transcriptData.duration if not found
      if (!duration && transcriptData.duration) {
        if (typeof transcriptData.duration === 'number') {
          duration = transcriptData.duration;
        } else if (typeof transcriptData.duration === 'string') {
          const parsed = parseFloat(transcriptData.duration);
          if (!isNaN(parsed)) {
            duration = parsed;
          }
        }
      }
      
      // Try other possible field names
      if (!duration) {
        const possibleFields = [
          metadata.length,
          metadata.lengthSeconds,
          metadata.durationSeconds,
          transcriptData.length,
          transcriptData.lengthSeconds,
          transcriptData.durationSeconds,
        ];
        
        for (const field of possibleFields) {
          if (field) {
            if (typeof field === 'number') {
              duration = field;
              break;
            } else if (typeof field === 'string') {
              const parsed = parseFloat(field);
              if (!isNaN(parsed)) {
                duration = parsed;
                break;
              }
            }
          }
        }
      }
      
      // If duration is still 0 or missing, fetch it directly from YouTube
      if (!duration || duration === 0) {
        try {
          console.log(`Duration not found in transcript API response, fetching from YouTube for video ${videoId}`);
          const youtube = await Innertube.create();
          const videoInfo = await youtube.getInfo(videoId);
          
          const durationInfo: any = videoInfo?.basic_info?.duration;
          if (durationInfo) {
            if (typeof durationInfo === 'object') {
              if (durationInfo.seconds !== undefined) {
                duration = Number(durationInfo.seconds);
                console.log(`Fetched duration from YouTube: ${duration} seconds (${Math.round(duration / 60)} minutes)`);
              } else if (durationInfo.seconds_text) {
                // Parse duration from text format like "15:30"
                const timeText = String(durationInfo.seconds_text);
                const timeParts = timeText.split(':');
                if (timeParts.length === 2) {
                  duration = parseInt(timeParts[0]) * 60 + parseInt(timeParts[1]);
                } else if (timeParts.length === 3) {
                  duration = parseInt(timeParts[0]) * 3600 + parseInt(timeParts[1]) * 60 + parseInt(timeParts[2]);
                }
                console.log(`Parsed duration from YouTube text: ${duration} seconds (${Math.round(duration / 60)} minutes)`);
              }
            } else if (typeof durationInfo === 'number') {
              duration = durationInfo;
              console.log(`Fetched duration from YouTube: ${duration} seconds (${Math.round(duration / 60)} minutes)`);
            }
          }
        } catch (youtubeError: any) {
          console.warn(`Failed to fetch duration from YouTube: ${youtubeError?.message || 'Unknown error'}`);
          // Continue without duration - we'll validate what we have
        }
      }
      
      // Log duration for debugging
      if (duration) {
        console.log(`Video duration: ${duration} seconds (${Math.round(duration / 60)} minutes)`);
      } else {
        console.warn(`Warning: Could not determine video duration for ${videoId}`);
      }
      
      // Extract thumbnail URL from metadata or construct from videoId
      let imageUrl: string | null = null;
      
      // Try to get thumbnail from metadata (check common field names)
      if (metadata.thumbnail) {
        imageUrl = metadata.thumbnail;
      } else if (metadata.thumbnail_url) {
        imageUrl = metadata.thumbnail_url;
      } else if (metadata.thumbnailUrl) {
        imageUrl = metadata.thumbnailUrl;
      } else if (metadata.thumbnails) {
        // If thumbnails is an object, try to get the highest quality
        if (typeof metadata.thumbnails === 'object') {
          imageUrl = metadata.thumbnails.maxresdefault || 
                     metadata.thumbnails.high || 
                     metadata.thumbnails.medium ||
                     metadata.thumbnails.default ||
                     Object.values(metadata.thumbnails)[0] as string;
        }
      } else if (transcriptData.thumbnail) {
        imageUrl = transcriptData.thumbnail;
      } else if (transcriptData.thumbnail_url) {
        imageUrl = transcriptData.thumbnail_url;
      }
      
      // Fallback: construct YouTube thumbnail URL from videoId
      if (!imageUrl && videoId) {
        // Try maxresdefault first (highest quality), fallback to hqdefault
        imageUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
      }
      
      // Check if API detected language (if available)
      const apiDetectedLanguage = transcriptData.language || metadata.language || transcriptData.lang;
      if (apiDetectedLanguage && apiDetectedLanguage.toLowerCase() !== 'de' && apiDetectedLanguage.toLowerCase() !== 'german') {
        console.warn(`Transcript API detected language: ${apiDetectedLanguage}, but proceeding with validation anyway`);
      }

      // Validate duration (must be 15 minutes or less = 900 seconds)
      // If duration is 0, we couldn't determine it, so we allow it through but log a warning
      if (duration > 900) {
        const minutes = Math.round(duration / 60);
        throw new BadRequestException(
          `This video is ${minutes} minutes long. Videos must be 15 minutes or shorter. Please select a shorter video.`,
        );
      }
      
      if (duration === 0) {
        console.warn(`Warning: Could not determine video duration for ${videoId}. Proceeding without duration validation.`);
      }

      // Validate that transcript is in German
      // Only validate if we have enough text (at least 50 characters)
      let languageValidation;
      if (transcriptText.length < 50) {
        console.warn('Transcript too short for language validation, skipping');
        languageValidation = { isGerman: true, message: 'Transcript too short to validate, proceeding' };
      } else {
        languageValidation = await this.validateGermanLanguage(transcriptText);
      }

      if (!languageValidation.isGerman) {
        // Log the actual transcript sample for debugging
        const sampleForDebug = transcriptText.substring(0, 300);
        console.error('Language validation failed. Sample text:', sampleForDebug);
        console.error('Full validation result:', JSON.stringify(languageValidation, null, 2));
        console.error('API detected language:', apiDetectedLanguage || 'not provided');
        
        // If confidence is very low or if API says it's German, be more lenient
        const confidence = languageValidation.confidence || 0;
        if (confidence < 0.4 || apiDetectedLanguage?.toLowerCase() === 'de' || apiDetectedLanguage?.toLowerCase() === 'german') {
          console.warn('Low confidence or API says German, but validation failed. Proceeding anyway.');
          languageValidation.isGerman = true;
        } else {
          throw new BadRequestException(
            `Language validation failed: ${languageValidation.message || 'The video transcript does not appear to be in German. Please use German-language videos only.'}`,
          );
        }
      }

      const data: any = {
        source: 'YouTube',
        url,
        videoId,
        title,
        duration,
        durationMinutes: Math.round(duration / 60),
        text: transcriptText,
        word_count: transcriptText.split(/\s+/).length,
        imageUrl: imageUrl || null,
        languageValidated: languageValidation.isGerman,
        languageValidationMessage: languageValidation.message,
        debug: {
          videoId,
          durationSeconds: duration,
          transcriptLength: transcriptText.length,
          languageCheck: languageValidation,
          metadata: metadata,
        },
      };

      return data;
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      // Handle transcript API specific errors
      if (error.response) {
        const status = error.response.status;
        const detail = error.response.data?.detail || error.message;

        if (status === 402) {
          throw new BadRequestException('Insufficient credits in transcript API account.');
        }
        if (status === 429) {
          throw new BadRequestException('Rate limit exceeded. Please try again later.');
        }
        if (status === 404 || status === 400) {
          throw new BadRequestException(
            `Failed to fetch transcript: ${detail || 'Video may not have captions or may be unavailable.'}`,
          );
        }
      }

      throw new BadRequestException(`Failed to scrape YouTube video: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Determines which scraper to use based on URL
   * @param url - The article or video URL
   * @returns The appropriate scraper method result
   */
  async scrapeArticle(url: string) {
    if (!url || typeof url !== 'string') {
      throw new BadRequestException('URL is required and must be a string');
    }

    // Normalize URL
    const normalizedUrl = url.trim();

    // Check if it's a YouTube URL
    if (normalizedUrl.includes('youtube.com') || normalizedUrl.includes('youtu.be')) {
      return await this.scrapeYouTube(normalizedUrl);
    }

    // Determine scraper based on URL
    if (normalizedUrl.includes('nachrichtenleicht.de')) {
      return await this.scrapeNachrichtenleicht(normalizedUrl);
    } else if (normalizedUrl.includes('dw.com')) {
      return await this.scrapeDW(normalizedUrl);
    } else {
      throw new BadRequestException(
        'Unsupported URL. Supported sources: Nachrichtenleicht (nachrichtenleicht.de), Deutsche Welle (dw.com), and YouTube videos (youtube.com or youtu.be).',
      );
    }
  }
}

