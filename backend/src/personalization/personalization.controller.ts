import { Controller, Get, Param, Post, Body, Query, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { PersonalizationService } from './personalization.service';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('Personalization')
@Controller('personalization')
@UseGuards(JwtAuthGuard)
export class PersonalizationController {
  constructor(private readonly personalizationService: PersonalizationService) {}

  @ApiOperation({ summary: 'Get all personalizations' })
  @Get()
  async getAll() {
    return this.personalizationService.getAll();
  }

  @ApiOperation({ summary: 'Get personalization by media ID' })
  @ApiParam({ name: 'mediaId', required: true, description: 'Media ID' })
  @Get(':mediaId')
  async getByMedia(
    @Param('mediaId') mediaId: string,
    @CurrentUser() user: { userId: string }
  ) {
    return this.personalizationService.getByMediaId(mediaId, user.userId);
  }

  @ApiOperation({ summary: 'Generate and store personalization for a media item (always generates new)' })
  @ApiParam({ name: 'mediaId', required: true, description: 'Media ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        cefr: { type: 'string', example: 'B1', description: 'CEFR level (A1, A2, B1, B2, C1, C2)' },
        interests: { type: 'array', items: { type: 'string' }, example: ['Travel', 'Culture'], description: 'User interests (1-5 items)' },
        studyMajor: { type: 'string', example: 'Computer Science / IT', description: 'Study major (optional)' },
        userId: { type: 'string', example: 'demo-user', description: 'User ID' },
        modelProvider: { type: 'string', enum: ['openai', 'groq', 'gemini'], example: 'gemini', description: 'Model provider: gemini (default), openai, or groq' }
      },
      required: ['cefr', 'interests', 'userId']
    }
  })
  @Post(':mediaId')
  async generateForMedia(
    @Param('mediaId') mediaId: string,
    @Body() body: { cefr: string; interests: string[]; studyMajor?: string; modelProvider?: 'openai' | 'groq' | 'gemini' },
    @CurrentUser() user: { userId: string }
  ) {
    try {
      if (!body.cefr || !body.interests) {
        throw new HttpException('Missing required fields: cefr, interests', HttpStatus.BAD_REQUEST);
      }
      const modelProvider = body.modelProvider || 'gemini';
      if (modelProvider !== 'openai' && modelProvider !== 'groq' && modelProvider !== 'gemini') {
        throw new HttpException('Invalid modelProvider. Must be "gemini", "openai", or "groq"', HttpStatus.BAD_REQUEST);
      }
      return await this.personalizationService.createPersonalization(mediaId, {
        cefr: body.cefr,
        interests: body.interests,
        studyMajor: body.studyMajor,
        userId: user.userId,
      }, modelProvider);
    } catch (error) {
      throw new HttpException(
        'Failed to generate personalization: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @ApiOperation({ summary: 'Regenerate a specific section (summary, vocabulary, or funFact)' })
  @ApiParam({ name: 'mediaId', required: true, description: 'Media ID' })
  @ApiParam({ name: 'section', required: true, description: 'Section to regenerate: summary, vocabulary, or funFact' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        cefr: { type: 'string', example: 'B1', description: 'CEFR level (A1, A2, B1, B2, C1, C2)' },
        interests: { type: 'array', items: { type: 'string' }, example: ['Travel', 'Culture'], description: 'User interests (1-5 items)' },
        studyMajor: { type: 'string', example: 'Computer Science / IT', description: 'Study major (optional)' },
        userId: { type: 'string', example: 'demo-user', description: 'User ID' },
        modelProvider: { type: 'string', enum: ['openai', 'groq', 'gemini'], example: 'gemini', description: 'Model provider: gemini (default), openai, or groq' }
      },
      required: ['cefr', 'interests', 'userId']
    }
  })
  @Post(':mediaId/regenerate/:section')
  async regenerateSection(
    @Param('mediaId') mediaId: string,
    @Param('section') section: 'summary' | 'vocabulary' | 'funFact',
    @Body() body: { cefr: string; interests: string[]; studyMajor?: string; modelProvider?: 'openai' | 'groq' | 'gemini' },
    @CurrentUser() user: { userId: string }
  ) {
    try {
      if (!['summary', 'vocabulary', 'funFact'].includes(section)) {
        throw new HttpException('Invalid section. Must be: summary, vocabulary, or funFact', HttpStatus.BAD_REQUEST);
      }
      if (!body.cefr || !body.interests) {
        throw new HttpException('Missing required fields: cefr, interests', HttpStatus.BAD_REQUEST);
      }
      const modelProvider = body.modelProvider || 'gemini';
      if (modelProvider !== 'openai' && modelProvider !== 'groq' && modelProvider !== 'gemini') {
        throw new HttpException('Invalid modelProvider. Must be "gemini", "openai", or "groq"', HttpStatus.BAD_REQUEST);
      }
      return await this.personalizationService.regenerateSection(mediaId, section, {
        cefr: body.cefr,
        interests: body.interests,
        studyMajor: body.studyMajor,
        userId: user.userId,
      }, modelProvider);
    } catch (error) {
      throw new HttpException(
        'Failed to regenerate section: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @ApiOperation({ summary: 'Get evaluation by media ID' })
  @ApiParam({ name: 'mediaId', required: true, description: 'Media ID' })
  @ApiQuery({ name: 'personalizationId', required: false, description: 'Personalization ID to filter by' })
  @Get(':mediaId/evaluation')
  async getEvaluation(
    @Param('mediaId') mediaId: string,
    @Query('personalizationId') personalizationId?: string,
  ) {
    try {
      console.log('Controller: getEvaluation called for mediaId:', mediaId, 'personalizationId:', personalizationId);
      const evaluation = await this.personalizationService.getEvaluationByMediaId(mediaId, personalizationId);
      if (!evaluation) {
        // Return 404 but don't throw - frontend will handle it
        throw new HttpException('Evaluation not found', HttpStatus.NOT_FOUND);
      }
      
      // Log what we're returning
      console.log('Controller: Returning evaluation:', {
        evaluationId: evaluation._id,
        mediaId: evaluation.mediaId,
        hasEvaluationData: !!evaluation.evaluationData,
        evaluationDataLength: evaluation.evaluationData?.length || 0,
        evaluationDataPreview: evaluation.evaluationData?.substring(0, 200),
      });
      
      // Ensure we return the raw evaluation data as-is
      const response = {
        _id: String(evaluation._id),
        mediaId: String(evaluation.mediaId),
        personalizationId: evaluation.personalizationId ? String(evaluation.personalizationId) : undefined,
        evaluationData: evaluation.evaluationData, // Keep as string
        userId: evaluation.userId,
        isGenerated: evaluation.isGenerated,
      };
      
      console.log('Controller: Response object:', {
        ...response,
        evaluationDataPreview: response.evaluationData?.substring(0, 200),
      });
      
      return response;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to get evaluation: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @ApiOperation({ summary: 'Generate evaluation for a media item' })
  @ApiParam({ name: 'mediaId', required: true, description: 'Media ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        personalizationId: { type: 'string', example: '507f1f77bcf86cd799439011', description: 'Personalization ID' },
        cefr: { type: 'string', example: 'B1', description: 'CEFR level (A1, A2, B1, B2, C1, C2)' },
        interests: { type: 'array', items: { type: 'string' }, example: ['Travel', 'Culture'], description: 'User interests' },
        studyMajor: { type: 'string', example: 'Computer Science / IT', description: 'Study major (optional)' },
        userId: { type: 'string', example: 'demo-user', description: 'User ID' },
      },
      required: ['personalizationId', 'cefr', 'userId'],
    },
  })
  @Post(':mediaId/evaluation')
  async generateEvaluation(
    @Param('mediaId') mediaId: string,
    @Body() body: { personalizationId: string; cefr: string; interests?: string[]; studyMajor?: string },
    @CurrentUser() user: { userId: string }
  ) {
    try {
      if (!body.personalizationId || !body.cefr) {
        throw new HttpException('Missing required fields: personalizationId, cefr', HttpStatus.BAD_REQUEST);
      }
      const evaluation = await this.personalizationService.generateEvaluation(mediaId, body.personalizationId, {
        cefr: body.cefr,
        interests: body.interests || [],
        studyMajor: body.studyMajor,
        userId: user.userId,
      });
      
      // Ensure we return the evaluation with evaluationData as string
      return {
        _id: String(evaluation._id),
        mediaId: String(evaluation.mediaId),
        personalizationId: evaluation.personalizationId ? String(evaluation.personalizationId) : undefined,
        evaluationData: evaluation.evaluationData, // Keep as string (already stringified in service)
        userId: evaluation.userId,
        isGenerated: evaluation.isGenerated,
      };
    } catch (error) {
      throw new HttpException(
        'Failed to generate evaluation: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @ApiOperation({ summary: 'Save evaluation progress' })
  @ApiParam({ name: 'mediaId', required: true, description: 'Media ID' })
  @Post(':mediaId/progress')
  async saveProgress(
    @Param('mediaId') mediaId: string,
    @Body() body: {
      evaluationId: string;
      results: {
        flashcards: { correct: number; total: number };
        mcqs: { correct: number; total: number };
        fillInTheBlanks: { correct: number; total: number };
      };
      cefr: string;
      goal: string;
    },
    @CurrentUser() user: { userId: string }
  ) {
    try {
      return await this.personalizationService.saveProgress(
        user.userId,
        mediaId,
        body.evaluationId,
        body.results,
        body.cefr,
        body.goal,
      );
    } catch (error) {
      throw new HttpException(
        'Failed to save progress: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @ApiOperation({ summary: 'Get user progress' })
  @Get('progress')
  async getProgress(@CurrentUser() user: { userId: string }) {
    try {
      return await this.personalizationService.getProgressByUserId(user.userId);
    } catch (error) {
      throw new HttpException(
        'Failed to get progress: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @ApiOperation({ summary: 'Get LLM feedback on short answer question' })
  @ApiParam({ name: 'mediaId', required: true, description: 'Media ID' })
  @Post(':mediaId/short-answer-feedback')
  async getShortAnswerFeedback(
    @Param('mediaId') mediaId: string,
    @Body() body: {
      question: string;
      userAnswer: string;
      modelAnswer: string;
      questionEn?: string;
      modelAnswerEn?: string;
    },
  ) {
    try {
      if (!body.question || !body.userAnswer || !body.modelAnswer) {
        throw new HttpException('Missing required fields: question, userAnswer, modelAnswer', HttpStatus.BAD_REQUEST);
      }
      return await this.personalizationService.getShortAnswerFeedback(
        body.question,
        body.userAnswer,
        body.modelAnswer,
        body.questionEn,
        body.modelAnswerEn,
      );
    } catch (error) {
      throw new HttpException(
        'Failed to get feedback: ' + error.message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
