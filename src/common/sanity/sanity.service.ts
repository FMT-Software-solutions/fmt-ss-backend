import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SanityClient } from '@sanity/client';

@Injectable()
export class SanityService {
  private client: SanityClient;

  constructor(private configService: ConfigService) {
    const projectId = this.configService.get<string>('SANITY_PROJECT_ID');
    const dataset = this.configService.get<string>('SANITY_DATASET');
    const token = this.configService.get<string>('SANITY_API_TOKEN');

    if (!projectId || !dataset) {
      throw new Error('Sanity configuration missing');
    }

    this.client = createClient({
      projectId,
      dataset,
      useCdn: false, // Ensure fresh data
      apiVersion: '2024-03-13',
      token, // Optional: needed for writing or reading private datasets
    });
  }

  getClient() {
    return this.client;
  }

  async fetch<T>(query: string, params: Record<string, any> = {}): Promise<T> {
    return this.client.fetch(query, params);
  }
}
