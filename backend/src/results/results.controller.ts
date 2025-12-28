import { Controller, Post, Get, Body, UseGuards, Param } from '@nestjs/common';
import { ResultsService } from './results.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { CurrentUser } from 'src/auth/current-user.decorator';

@Controller('results')
@UseGuards(JwtAuthGuard)
export class ResultsController {
  constructor(private readonly resultsService: ResultsService) {}

  @Post()
  async createResult(
    @CurrentUser() user: any,
    @Body() body: {
      evaluationId: string;
      personalizationId: string;
      questionsAnsweredCorrectly: number[];
      questionsAnsweredWrong: number[];
      finalScore: number;
    },
  ) {
    return await this.resultsService.createResult(
      body.evaluationId,
      body.personalizationId,
      user.userId,
      body.questionsAnsweredCorrectly,
      body.questionsAnsweredWrong,
      body.finalScore,
    );
  }

  @Get('evaluation/:evaluationId')
  async getResultByEvaluationId(
    @CurrentUser() user: any,
    @Param('evaluationId') evaluationId: string,
  ) {
    return await this.resultsService.getResultByEvaluationId(
      evaluationId,
      user.userId,
    );
  }

  @Get('my-results')
  async getUserResults(@CurrentUser() user: any) {
    return await this.resultsService.getUserResults(user.userId);
  }
}

