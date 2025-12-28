import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from '../Models/user.schema';
import { SignupDto, LoginDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    private readonly jwtService: JwtService,
  ) {}

  async signup(signupDto: SignupDto): Promise<{ access_token: string; user: { id: string; username: string; email: string } }> {
    const { username, email, password } = signupDto;

    // Check if user already exists
    const existingUser = await this.userModel.findOne({
      $or: [{ email }, { username }],
    });

    if (existingUser) {
      throw new ConflictException('User with this email or username already exists');
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user
    const user = await this.userModel.create({
      username,
      email,
      password: hashedPassword,
    });

    // Generate JWT token
    const userId = String(user._id);
    const payload = { sub: userId, email: user.email, username: user.username };
    const access_token = this.jwtService.sign(payload);

    return {
      access_token,
      user: {
        id: userId,
        username: user.username,
        email: user.email,
      },
    };
  }

  async login(loginDto: LoginDto): Promise<{ access_token: string; user: { id: string; username: string; email: string } }> {
    const { email, password } = loginDto;

    // Find user by email
    const user = await this.userModel.findOne({ email: email.toLowerCase() });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate JWT token
    const userId = String(user._id);
    const payload = { sub: userId, email: user.email, username: user.username };
    const access_token = this.jwtService.sign(payload);

    return {
      access_token,
      user: {
        id: userId,
        username: user.username,
        email: user.email,
      },
    };
  }

  async validateUser(userId: string): Promise<User | null> {
    const user = await this.userModel.findById(userId);
    if (!user || !user.isActive) {
      return null;
    }
    return user;
  }
}

