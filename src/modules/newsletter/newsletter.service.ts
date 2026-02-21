import { Injectable, BadRequestException, InternalServerErrorException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { SubscribeDto } from './dto/subscribe.dto';
import { randomUUID } from 'crypto';

@Injectable()
export class NewsletterService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) { }

  async subscribe(subscribeDto: SubscribeDto) {
    const { email } = subscribeDto;
    const supabase: any = this.supabaseService.getClient();

    // Check if email already exists
    const { data: existingSubscriber, error: findError } = await supabase
      .from('newsletter_subscribers')
      .select('*')
      .eq('email', email)
      .single();

    if (existingSubscriber) {
      return { message: 'You are already subscribed to our newsletter.' };
    }

    // Check if error is really "not found" or actual error
    // Supabase returns error code 'PGRST116' for no rows found on .single()
    if (findError && findError.code !== 'PGRST116') {
      console.error('Error finding subscriber:', findError);
      throw new InternalServerErrorException('Database error');
    }

    // Generate a unique token for unsubscribing
    const unsubscribeToken = randomUUID();

    // Add email to database
    const { error: insertError } = await supabase
      .from('newsletter_subscribers')
      .insert([
        {
          email,
          subscribedAt: new Date().toISOString(),
          unsubscribeToken: unsubscribeToken,
        },
      ]);

    if (insertError) {
      console.error('Error inserting subscriber:', insertError);
      throw new InternalServerErrorException('Failed to subscribe. Please try again.');
    }

    // Generate unsubscribe URL
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    const unsubscribeUrl = `${frontendUrl}/newsletter/unsubscribe?token=${unsubscribeToken}`;

    return {
      message: 'Subscribed successfully',
      unsubscribeUrl
    };
  }

  async unsubscribe(token: string) {
    const supabase: any = this.supabaseService.getClient();

    // Find subscriber by token
    const { data: subscribers, error } = await supabase
      .from('newsletter_subscribers')
      .select('*')
      .eq('unsubscribeToken', token);

    if (error) {
      throw new InternalServerErrorException('Failed to process unsubscribe request');
    }

    if (!subscribers || subscribers.length === 0) {
      throw new BadRequestException('Invalid unsubscribe token or already unsubscribed');
    }

    // Delete subscriber
    const { error: deleteError } = await supabase
      .from('newsletter_subscribers')
      .delete()
      .eq('unsubscribeToken', token);

    if (deleteError) {
      throw new InternalServerErrorException('Failed to unsubscribe');
    }

    return { message: 'Successfully unsubscribed from the newsletter' };
  }

  async unsubscribeByEmail(email: string) {
    const supabase: any = this.supabaseService.getClient();

    // Check if email exists
    const { data: subscriber, error: findError } = await supabase
      .from('newsletter_subscribers')
      .select('*')
      .eq('email', email)
      .single();

    if (findError && findError.code !== 'PGRST116') {
      console.error('Error finding subscriber:', findError);
      throw new InternalServerErrorException('Database error');
    }

    if (!subscriber) {
      // For security reasons, we might want to return success even if email not found,
      // but for now let's be explicit as requested
      throw new BadRequestException('This email is not subscribed to our newsletter');
    }

    // Delete subscriber
    const { error: deleteError } = await supabase
      .from('newsletter_subscribers')
      .delete()
      .eq('email', email);

    if (deleteError) {
      console.error('Error deleting subscriber:', deleteError);
      throw new InternalServerErrorException('Failed to unsubscribe');
    }

    return { message: 'Successfully unsubscribed from the newsletter' };
  }
}
