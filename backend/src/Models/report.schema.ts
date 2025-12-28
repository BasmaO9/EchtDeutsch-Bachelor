import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Report extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true })
  userName: string;

  @Prop({ type: Types.ObjectId, ref: 'Media', required: true })
  currentMediaId: Types.ObjectId;

  @Prop({ type: String, required: true })
  mediaLink: string;

  @Prop({ type: String, required: true })
  reportMessage: string;

  @Prop({ type: Types.ObjectId, ref: 'Evaluation', required: false })
  evaluationId?: Types.ObjectId;
}

export const ReportSchema = SchemaFactory.createForClass(Report);
ReportSchema.index({ userId: 1 });
ReportSchema.index({ currentMediaId: 1 });
ReportSchema.index({ createdAt: -1 });

