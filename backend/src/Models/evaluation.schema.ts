import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Evaluation extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Media', required: true })
  mediaId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Personalization', required: true })
  personalizationId: Types.ObjectId;

  @Prop({ required: true })
  evaluationData: string; // JSON string containing the full evaluation structure

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId; // User ID for tracking

  @Prop({ default: false })
  isGenerated: boolean; // Whether evaluation has been generated
}

export const EvaluationSchema = SchemaFactory.createForClass(Evaluation);
EvaluationSchema.index({ mediaId: 1, personalizationId: 1 }, { unique: true });

