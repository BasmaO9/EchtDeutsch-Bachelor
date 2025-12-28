import { Controller, Post, Get, Body, Param, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('Reports')
@Controller('reports')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @ApiOperation({ summary: 'Submit a bug/hallucination report' })
  @ApiResponse({ status: 201, description: 'Report submitted successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - missing required fields' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Post()
  async createReport(
    @Body() createReportDto: CreateReportDto,
    @CurrentUser() user: { userId: string },
  ) {
    // Ensure the userId matches the authenticated user
    if (createReportDto.userId !== user.userId) {
      throw new HttpException(
        'User ID mismatch',
        HttpStatus.FORBIDDEN,
      );
    }

    try {
      const report = await this.reportsService.createReport(createReportDto);
      return {
        success: true,
        message: 'Report submitted successfully',
        reportId: report._id,
      };
    } catch (error) {
      throw new HttpException(
        'Failed to create report',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @ApiOperation({ summary: 'Get all reports (admin only)' })
  @ApiResponse({ status: 200, description: 'List of all reports' })
  @Get()
  async getAllReports() {
    return this.reportsService.getAllReports();
  }

  @ApiOperation({ summary: 'Get reports by user ID' })
  @ApiResponse({ status: 200, description: 'List of user reports' })
  @Get('user/:userId')
  async getReportsByUserId(@Param('userId') userId: string) {
    return this.reportsService.getReportsByUserId(userId);
  }

  @ApiOperation({ summary: 'Get reports by media ID' })
  @ApiResponse({ status: 200, description: 'List of reports for a media item' })
  @Get('media/:mediaId')
  async getReportsByMediaId(@Param('mediaId') mediaId: string) {
    return this.reportsService.getReportsByMediaId(mediaId);
  }
}

