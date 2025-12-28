import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Progress extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Media', required: true })
  mediaId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Evaluation', required: true })
  evaluationId: Types.ObjectId;

  @Prop({ required: true })
  score: number; // Percentage score (0-100)

  @Prop({ required: true })
  grade: string; // A, B, C, D, F

  @Prop({ required: true, type: Object })
  results: {
    flashcards: { correct: number; total: number };
    mcqs: { correct: number; total: number };
    fillInTheBlanks: { correct: number; total: number };
  };

  @Prop({ required: true, type: String })
  advice: string; // Personalized advice based on performance

  @Prop({ required: true })
  cefr: string; // CEFR level at time of evaluation

  @Prop({ required: true })
  goal: string; // Learning goal at time of evaluation

  @Prop({ default: Date.now })
  completedAt: Date;
}

export const ProgressSchema = SchemaFactory.createForClass(Progress);
ProgressSchema.index({ userId: 1, mediaId: 1 }, { unique: false });
ProgressSchema.index({ userId: 1, completedAt: -1 });

