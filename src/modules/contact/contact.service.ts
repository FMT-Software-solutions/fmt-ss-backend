import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ResendService } from '../../common/resend/resend.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { Database } from '../../common/supabase/database.types';

type MessageInsert = Database['public']['Tables']['messages']['Insert'];
type MessageUpdate = Database['public']['Tables']['messages']['Update'];

@Injectable()
export class ContactService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly resendService: ResendService,
  ) { }

  async createContact(createContactDto: CreateContactDto) {
    const { name, email, message } = createContactDto;
    const supabase: any = this.supabaseService.getClient();

    // Save to Supabase
    const insertData: MessageInsert = {
      name,
      email,
      message,
      status: 'pending',
    };

    const { error: dbError } = await supabase.from('messages').insert(insertData);

    if (dbError) {
      console.error('Error saving to database:', dbError);
      throw new InternalServerErrorException('Failed to save message');
    }

    try {
      // Send email using Resend
      const { error: emailError } = await this.resendService.sendEmail({
        from: 'contact@fmtsoftware.com',
        to: 'fmtsoftwaresolutions@gmail.com',
        subject: `New Contact Form Submission from ${name}`,
        html: `
          <h1>New Contact Form Submission</h1>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Message:</strong></p>
          <p>${message}</p>
        `,
        cc: 'ankomaheneshadrack@gmail.com',
      });

      if (emailError) {
        console.error('Error sending email:', emailError);
        // Update message status to failed
        const updateData: MessageUpdate = { status: 'failed' };
        // We can't easily update without ID, so we skip update or rely on email match if really needed
        // For now, just logging error

        throw new Error('Failed to send email');
      }

      // Update message status to sent - skipping as we don't have ID easily
    } catch (error) {
      console.error('Error in contact flow:', error);
      throw new InternalServerErrorException('Failed to process contact request');
    }
  }

  async createContactOptimized(createContactDto: CreateContactDto) {
    const { name, email, message } = createContactDto;
    const supabase: any = this.supabaseService.getClient();

    // Save to Supabase and return ID
    const insertData: MessageInsert = {
      name,
      email,
      message,
      status: 'pending',
    };

    const { data, error: dbError } = await supabase
      .from('messages')
      .insert(insertData)
      .select()
      .single();

    if (dbError) {
      console.error('Error saving to database:', dbError);
      throw new InternalServerErrorException('Failed to save message');
    }

    const messageId = data.id;

    // Send email
    const { error: emailError } = await this.resendService.sendEmail({
      from: 'contact@fmtsoftware.com',
      to: 'fmtsoftwaresolutions@gmail.com',
      subject: `New Contact Form Submission from ${name}`,
      html: `
          <h1>New Contact Form Submission</h1>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Message:</strong></p>
          <p>${message}</p>
        `,
      cc: 'ankomaheneshadrack@gmail.com',
    });

    if (emailError) {
      console.error('Error sending email:', emailError);
      const updateData: MessageUpdate = { status: 'failed' };
      await supabase.from('messages').update(updateData).eq('id', messageId);
      throw new InternalServerErrorException('Failed to send email');
    }

    const updateData: MessageUpdate = { status: 'sent' };
    await supabase.from('messages').update(updateData).eq('id', messageId);

    return { message: 'Message sent successfully' };
  }
}
