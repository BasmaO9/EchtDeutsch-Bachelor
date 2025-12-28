import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Media } from 'src/Models/media.schema';
import { Personalization } from 'src/Models/personalization.schema';
import { ScraperService } from '../scraper/scraper.service';
import { CefrClassificationService } from '../text-analysis/cefr-classification.service';

@Injectable()
export class MediaService {
  constructor(
    @InjectModel(Media.name) private mediaModel: Model<Media>,
    @InjectModel(Personalization.name) private personalizationModel: Model<Personalization>,
    private readonly scraperService: ScraperService,
    private readonly cefrClassificationService: CefrClassificationService,
  ) {}

  async createMedia(createMediaDto: Partial<Media>): Promise<Media> {
    // If transcript exists and CEFR is not already set, classify it
    if (createMediaDto.transcript && !createMediaDto.cefr) {
      try {
        console.log('Classifying transcript by CEFR level...');
        const cefrLevel = await this.cefrClassificationService.classifyText(createMediaDto.transcript);
        createMediaDto.cefr = cefrLevel;
        console.log(`Transcript classified as CEFR level: ${cefrLevel}`);
      } catch (error) {
        console.error('Failed to classify transcript by CEFR level:', error);
        // Continue without CEFR level if classification fails
        // Don't throw error - allow media creation to proceed
      }
    }

    const media = new this.mediaModel(createMediaDto);
    return media.save();
  }

  async getAllMedia(): Promise<Media[]> {
    return this.mediaModel.find().exec();
  }

  async getMediaById(id: string): Promise<Media> {
    const media = await this.mediaModel.findById(id);
    if (!media) throw new NotFoundException('Media not found');
    return media;
  }

  async markAsPersonalized(mediaId: string): Promise<Media> {
    const media = await this.mediaModel.findById(mediaId);
    if (!media) throw new NotFoundException('Media not found');
    return media;
  }

  /**
   * Scrapes an article or video from a supported website and saves it as a media item
   * @param url - The URL of the article or video to scrape
   * @returns The created media item
   */
  async scrapeAndSaveArticle(url: string): Promise<Media> {
    // Scrape the article or video
    const scrapedData = await this.scraperService.scrapeArticle(url);

    // Determine media type based on source
    const mediaType = scrapedData.source === 'YouTube' ? 'video' : 'article';

    // Map scraper output to media schema
    const mediaData: Partial<Media> = {
      title: scrapedData.title || (mediaType === 'video' ? 'Untitled Video' : 'Untitled Article'),
      type: mediaType,
      sourceUrl: scrapedData.url,
      transcript: scrapedData.text || '',
      cefr: '', // Will be set by createMedia if transcript exists
      topic: '', // Leave empty as requested
      imageUrl: scrapedData.imageUrl || undefined,
      visibility: 'private', // Default to private
    };

    // Create and save media item (CEFR will be classified automatically in createMedia)
    return this.createMedia(mediaData);
  }
}
