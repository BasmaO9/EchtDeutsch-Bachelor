import { PartialType } from '@nestjs/swagger';
import { CreatePersonalizationDto } from './create-personalization.dto';

export class UpdatePersonalizationDto extends PartialType(CreatePersonalizationDto) {}
