import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

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

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  userId?: Types.ObjectId;

  @Prop({ enum: ['global', 'private'], default: 'private' })
  visibility: 'global' | 'private';
}

export const MediaSchema = SchemaFactory.createForClass(Media);
