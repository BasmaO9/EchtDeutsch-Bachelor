import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CEFREnum = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
export type GoalEnum = 'vocabulary' | 'reading' | 'grammar' | 'general';
export type ConfidenceEnum = 'low' | 'medium' | 'high';

@Schema({ timestamps: true })
export class UserProfile extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] })
  cefr: CEFREnum;

  @Prop({ type: [String], default: [], validate: { validator: (v: string[]) => v.length > 0 && v.length <= 5, message: 'Interests must have between 1 and 5 items' } })
  interests: string[];

  @Prop({ required: true, enum: ['vocabulary', 'reading', 'grammar', 'general'] })
  goal: GoalEnum;

  @Prop({ required: true, enum: ['low', 'medium', 'high'] })
  confidence: ConfidenceEnum;

  @Prop({ required: false, type: String })
  studyMajor?: string;

  @Prop({ required: true, default: () => new Date() })
  lastUpdated: Date;
}

export const UserProfileSchema = SchemaFactory.createForClass(UserProfile);
UserProfileSchema.index({ userId: 1 }, { unique: true });
UserProfileSchema.index({ userId: 1 });

