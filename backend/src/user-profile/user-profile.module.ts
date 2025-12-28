import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  UserProfile,
  UserProfileSchema,
} from '../Models/user-profile.schema';
import { UserProfileController } from './user-profile.controller';
import { UserProfileService } from './user-profile.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserProfile.name, schema: UserProfileSchema },
    ]),
  ],
  controllers: [UserProfileController],
  providers: [UserProfileService],
  exports: [UserProfileService],
})
export class UserProfileModule {}

