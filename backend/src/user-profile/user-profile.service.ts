import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Types } from 'mongoose';
import { UserProfile } from '../Models/user-profile.schema';
import { UpsertUserProfileDto } from './dto/user-profile.dto';

@Injectable()
export class UserProfileService {
  constructor(
    @InjectModel(UserProfile.name)
    private readonly userProfileModel: Model<UserProfile>,
  ) {}

  async getProfile(userId: string): Promise<UserProfile> {
    const userObjectId = new Types.ObjectId(userId);
    const profile = await this.userProfileModel.findOne({ userId: userObjectId });
  
    if (!profile) {
      throw new NotFoundException('User profile not found');
    }
  
    return profile.toObject() as UserProfile;
  }
  
  async upsertProfile(userId: string, payload: UpsertUserProfileDto): Promise<UserProfile> {
    const userObjectId = new Types.ObjectId(userId);
    
    // Get existing profile to preserve fields not in payload
    const existingProfile = await this.userProfileModel.findOne({ userId: userObjectId });
    
    // Merge existing profile with payload (payload takes precedence)
    const update = {
      ...(existingProfile?.toObject() || {}),
      ...payload,
      userId: userObjectId,
      lastUpdated: new Date(),
    };
    
    // Remove MongoDB-specific fields
    delete (update as any)._id;
    delete (update as any).__v;
    
    const profile = await this.userProfileModel.findOneAndUpdate(
      { userId: userObjectId },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    
    return profile.toObject() as UserProfile;
  }
  
}

