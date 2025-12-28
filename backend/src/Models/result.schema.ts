import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Result extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Evaluation', required: true })
  evaluationId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Personalization', required: true })
  personalizationId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: [Number], default: [] })
  questionsAnsweredCorrectly: number[]; // Array of question numbers (1, 2, 3, etc.)

  @Prop({ type: [Number], default: [] })
  questionsAnsweredWrong: number[]; // Array of question numbers (1, 2, 3, etc.)

  @Prop({ required: true })
  finalScore: number; // Total score (number of correct answers)
}

export const ResultSchema = SchemaFactory.createForClass(Result);
ResultSchema.index({ evaluationId: 1, userId: 1 }, { unique: true });

