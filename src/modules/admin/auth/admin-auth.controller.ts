import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AdminAuthService } from './admin-auth.service';
import { ForgotPasswordDto } from './dto/admin-auth.dto';

// Pre-login surface: intentionally NOT behind AdminAuthGuard. The OTP is
// verified client-side via supabase.auth.verifyOtp({ type: 'recovery' }).
@ApiTags('Admin Auth')
@Controller('admin-auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) { }

  @Post('forgot-password')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Send a password-reset OTP to an admin email' })
  @ApiResponse({ status: 200, description: 'Generic acknowledgement (no account enumeration)' })
  @ApiResponse({ status: 429, description: 'Cooldown or request limit hit' })
  async forgotPassword(@Body() payload: ForgotPasswordDto) {
    return this.adminAuthService.forgotPassword(payload.email);
  }
}
