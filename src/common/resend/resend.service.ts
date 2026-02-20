import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class ResendService {
  private resend: Resend;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      throw new Error('RESEND_API_KEY not found in environment variables');
    }
    this.resend = new Resend(apiKey);
  }

  get client() {
    return this.resend;
  }
  
  async sendEmail(payload: any) {
    return this.resend.emails.send(payload);
  }
}
