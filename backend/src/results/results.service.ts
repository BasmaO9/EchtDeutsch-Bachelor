import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Result } from 'src/Models/result.schema';

@Injectable()
export class ResultsService {
  constructor(
    @InjectModel(Result.name) private resultModel: Model<Result>,
  ) {}

  async createResult(
    evaluationId: string,
    personalizationId: string,
    userId: string,
    questionsAnsweredCorrectly: number[],
    questionsAnsweredWrong: number[],
    finalScore: number,
  ): Promise<Result> {
    // Check if result already exists for this evaluation and user
    const existingResult = await this.resultModel.findOne({
      evaluationId: new Types.ObjectId(evaluationId),
      userId: new Types.ObjectId(userId),
    });

    if (existingResult) {
      // Update existing result
      existingResult.questionsAnsweredCorrectly = questionsAnsweredCorrectly;
      existingResult.questionsAnsweredWrong = questionsAnsweredWrong;
      existingResult.finalScore = finalScore;
      return await existingResult.save();
    }

    // Create new result
    const result = new this.resultModel({
      evaluationId: new Types.ObjectId(evaluationId),
      personalizationId: new Types.ObjectId(personalizationId),
      userId: new Types.ObjectId(userId),
      questionsAnsweredCorrectly,
      questionsAnsweredWrong,
      finalScore,
    });

    return await result.save();
  }

  async getResultByEvaluationId(
    evaluationId: string,
    userId: string,
  ): Promise<Result | null> {
    return await this.resultModel.findOne({
      evaluationId: new Types.ObjectId(evaluationId),
      userId: new Types.ObjectId(userId),
    });
  }

  async getUserResults(userId: string): Promise<Result[]> {
    return await this.resultModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .exec();
  }
}

