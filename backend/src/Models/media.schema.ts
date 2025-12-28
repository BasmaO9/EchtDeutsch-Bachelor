import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Media extends Document {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true, enum: ['video', 'podcast', 'article'] })
  type: string;

  @Prop()
  sourceUrl: string;

  @Prop()
  transcript: string;

  @Prop()
  cefr: string;

  @Prop()
  topic: string;

  @Prop()
  imageUrl: string;

  @Prop({ required: false })
  userId?: string;

  @Prop({ enum: ['global', 'private'], default: 'private' })
  visibility: 'global' | 'private';
}

export const MediaSchema = SchemaFactory.createForClass(Media);
