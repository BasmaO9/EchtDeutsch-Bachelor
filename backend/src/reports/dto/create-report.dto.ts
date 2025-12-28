import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateReportDto {
  @ApiProperty({ example: 'user123', description: 'User ID' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ example: 'John Doe', description: 'User name' })
  @IsString()
  @IsNotEmpty()
  userName: string;

  @ApiProperty({ example: 'media123', description: 'Current media ID' })
  @IsString()
  @IsNotEmpty()
  currentMediaId: string;

  @ApiProperty({ example: 'https://www.dw.com/de/article-url', description: 'Media source URL (original source link)' })
  @IsString()
  @IsNotEmpty()
  mediaLink: string;

  @ApiProperty({ example: 'The translation seems incorrect...', description: 'Report message' })
  @IsString()
  @IsNotEmpty()
  reportMessage: string;

  @ApiPropertyOptional({ example: 'eval123', description: 'Evaluation ID (optional)' })
  @IsString()
  @IsOptional()
  evaluationId?: string;
}

