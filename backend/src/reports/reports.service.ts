import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Types } from 'mongoose';
import { Report } from '../Models/report.schema';
import { CreateReportDto } from './dto/create-report.dto';

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Report.name) private reportModel: Model<Report>,
  ) {}

  async createReport(createReportDto: CreateReportDto): Promise<Report> {
    // Convert string IDs to ObjectIds
    const reportData = {
      ...createReportDto,
      userId: new Types.ObjectId(createReportDto.userId),
      currentMediaId: new Types.ObjectId(createReportDto.currentMediaId),
      evaluationId: createReportDto.evaluationId 
        ? new Types.ObjectId(createReportDto.evaluationId) 
        : undefined,
    };
    
    const report = new this.reportModel(reportData);
    return report.save();
  }

  async getAllReports(): Promise<Report[]> {
    return this.reportModel.find().sort({ createdAt: -1 }).exec();
  }

  async getReportsByUserId(userId: string): Promise<Report[]> {
    const userObjectId = new Types.ObjectId(userId);
    return this.reportModel.find({ userId: userObjectId }).sort({ createdAt: -1 }).exec();
  }

  async getReportsByMediaId(mediaId: string): Promise<Report[]> {
    const mediaObjectId = new Types.ObjectId(mediaId);
    return this.reportModel.find({ currentMediaId: mediaObjectId }).sort({ createdAt: -1 }).exec();
  }
}

