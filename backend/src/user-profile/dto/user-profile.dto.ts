import {
    IsArray,
    ArrayNotEmpty,
    IsString,
    IsIn,
    IsOptional,
    ArrayMaxSize,
    ArrayMinSize,
  } from 'class-validator';
  
  import type {
    CEFREnum,
    GoalEnum,
    ConfidenceEnum,
  } from '../../Models/user-profile.schema';
  
  export class UpsertUserProfileDto {
    @IsOptional()
    @IsIn(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])
    cefr?: CEFREnum;
  
    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(5)
    @IsString({ each: true })
    interests?: string[];
  
    @IsOptional()
    @IsIn(['vocabulary', 'reading', 'grammar', 'general'])
    goal?: GoalEnum;
  
    @IsOptional()
    @IsIn(['low', 'medium', 'high'])
    confidence?: ConfidenceEnum;
  
    @IsOptional()
    @IsString()
    studyMajor?: string;
  
    @IsOptional()
    lastUpdated?: Date;
  }
  