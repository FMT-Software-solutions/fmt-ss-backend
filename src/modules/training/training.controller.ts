import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { TrainingService } from './training.service';
import { RegisterTrainingDto } from './dto/register-training.dto';

@ApiTags('Training')
@Controller('training')
export class TrainingController {
  constructor(private readonly trainingService: TrainingService) {}

  @Post('register')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Register for a training program' })
  @ApiResponse({ status: 201, description: 'Registration successful or payment required' })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 404, description: 'Training not found' })
  register(@Body() registerDto: RegisterTrainingDto) {
    return this.trainingService.register(registerDto);
  }
}
