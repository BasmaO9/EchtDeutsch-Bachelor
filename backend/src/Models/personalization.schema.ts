import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Personalization extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Media', required: true })
  mediaId: Types.ObjectId;

  @Prop()
  summary: string; // JSON with German and English summary

  @Prop()
  vocabulary: string; // JSON array with vocab items (German/English, part of speech, usage)

  @Prop()
  funFact: string; // JSON with German and English fun fact

  @Prop()
  naturalExpressions: string; // JSON array with natural expressions/spoken fillers

  @Prop()
  cultureNugget: string; // JSON with German and English culture nugget

  @Prop()
  personalizableElement: string; // JSON with German and English personalized element

  @Prop()
  modelUsed: string; // e.g., 'gpt-4', 'gpt-3.5-turbo', etc.

  @Prop()
  userLevel: string; // CEFR level used for personalization

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId; // User ID for personalization tracking

  @Prop()
  cefrAnalysis?: string; // JSON string with CEFR level analysis results
}

export const PersonalizationSchema = SchemaFactory.createForClass(Personalization);
