import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ArkeselService {
  private readonly logger = new Logger(ArkeselService.name);
  private readonly apiKey?: string;
  private readonly baseUrl = 'https://sms.arkesel.com/api/v2';

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('ARKESEL_API_KEY');
  }

  private async fetchApi(endpoint: string, method: string, payload?: any) {
    if (!this.apiKey) {
      throw new Error('ARKESEL_API_KEY is not configured');
    }

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
        },
        body: payload ? JSON.stringify(payload) : undefined,
      });

      // Handle non-JSON responses gracefully (e.g., 500 HTML errors from Arkesel)
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();

        if (!response.ok) {
          this.logger.error(`Arkesel API Error [${endpoint}]: ${JSON.stringify(data)}`);
          throw new Error(data.message || 'Failed to interact with Arkesel API');
        }

        return data;
      } else {
        const textData = await response.text();
        this.logger.error(`Arkesel API Error (Non-JSON) [${endpoint}]: Status ${response.status} - ${textData}`);
        throw new Error(`Arkesel API Error: ${response.statusText}`);
      }
    } catch (error: any) {
      this.logger.error(`Error communicating with Arkesel: ${error.message}`);
      throw error;
    }
  }

  async sendStandardSms(sender: string, message: string, recipients: string[], sandbox?: boolean, callbackUrl?: string) {
    const payload: any = { sender, message, recipients };
    if (sandbox !== undefined) payload.sandbox = sandbox;
    if (callbackUrl) payload.callback_url = callbackUrl;

    const data = await this.fetchApi('/sms/send', 'POST', payload);
    this.logger.log(`Successfully sent Standard SMS via Arkesel to ${recipients.length} recipients.`);
    return data;
  }

  async scheduleStandardSms(sender: string, message: string, recipients: string[], scheduledDate: string, sandbox?: boolean) {
    const payload: any = { sender, message, recipients, scheduled_date: scheduledDate };
    if (sandbox !== undefined) payload.sandbox = sandbox;

    const data = await this.fetchApi('/sms/send', 'POST', payload);
    this.logger.log(`Successfully scheduled Standard SMS via Arkesel for ${recipients.length} recipients.`);
    return data;
  }

  async sendTemplateSms(sender: string, message: string, recipients: Record<string, Record<string, string>>, sandbox?: boolean, callbackUrl?: string) {
    const payload: any = { sender, message, recipients };
    if (sandbox !== undefined) payload.sandbox = sandbox;
    if (callbackUrl) payload.callback_url = callbackUrl;

    const data = await this.fetchApi('/sms/template/send', 'POST', payload);
    this.logger.log(`Successfully sent Template SMS via Arkesel to ${Object.keys(recipients).length} recipients.`);
    return data;
  }

  async scheduleTemplateSms(sender: string, message: string, recipients: Record<string, Record<string, string>>, scheduledDate: string, sandbox?: boolean) {
    const payload: any = { sender, message, recipients, scheduled_date: scheduledDate };
    if (sandbox !== undefined) payload.sandbox = sandbox;

    const data = await this.fetchApi('/sms/template/send', 'POST', payload);
    this.logger.log(`Successfully scheduled Template SMS via Arkesel for ${Object.keys(recipients).length} recipients.`);
    return data;
  }

  async checkBalance() {
    const data = await this.fetchApi('/clients/balance-details', 'GET');
    this.logger.log(`Successfully checked Arkesel balance.`);
    return data;
  }

  async getSmsDetails(smsId: string) {
    const data = await this.fetchApi(`/sms/${smsId}`, 'GET');
    this.logger.log(`Successfully fetched details for SMS ID: ${smsId}`);
    return data;
  }
}
