import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserProfileService } from './user-profile.service';
import { UpsertUserProfileDto } from './dto/user-profile.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('user/profile')
@UseGuards(JwtAuthGuard)
export class UserProfileController {
  constructor(private readonly userProfileService: UserProfileService) {}

  @Get()
  async getProfile(@CurrentUser() user: { userId: string }) {
    return this.userProfileService.getProfile(user.userId);
  }

  @Post()
  async upsertProfile(
    @Body() payload: UpsertUserProfileDto,
    @CurrentUser() user: { userId: string },
  ) {
    const profile = await this.userProfileService.upsertProfile(
      user.userId,
      payload,
    );
    return { success: true, profile };
  }
}

