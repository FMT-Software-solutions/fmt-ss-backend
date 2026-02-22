import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ResendService } from '../../common/resend/resend.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { parseEmailList } from '../../common/utils/email.utils';

@Injectable()
export class QuotesService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly resendService: ResendService,
    private readonly configService: ConfigService,
  ) { }

  async create(createQuoteDto: CreateQuoteDto) {
    const supabase = this.supabaseService.getClient();

    const { error } = await supabase.from('quotes').insert([
      {
        first_name: createQuoteDto.firstName,
        last_name: createQuoteDto.lastName,
        email: createQuoteDto.email,
        contact_number_1: createQuoteDto.contactNumber1,
        contact_number_2: createQuoteDto.contactNumber2,
        company: createQuoteDto.company,
        service_type: createQuoteDto.serviceType,
        budget: createQuoteDto.budget,
        description: createQuoteDto.description,
        status: 'requested', // Default status
      },
    ]);

    if (error) {
      console.error('Error creating quote:', error);
      throw new InternalServerErrorException('Failed to submit quote request');
    }

    try {
      const adminEmails = parseEmailList(this.configService.get('ADMIN_EMAILS'));
      const toEmails = adminEmails.length > 0 ? adminEmails : ['fmtsoftwaresolutions@gmail.com'];

      // Send email notification
      const { error: emailError } = await this.resendService.sendEmail({
        from: 'quotes@fmtsoftware.com',
        to: toEmails,
        subject: `New Quote Request from ${createQuoteDto.firstName} ${createQuoteDto.lastName}`,
        html: `
          <h1>New Quote Request</h1>
          <p><strong>Name:</strong> ${createQuoteDto.firstName} ${createQuoteDto.lastName}</p>
          <p><strong>Email:</strong> ${createQuoteDto.email}</p>
          <p><strong>Contact 1:</strong> ${createQuoteDto.contactNumber1}</p>
          ${createQuoteDto.contactNumber2 ? `<p><strong>Contact 2:</strong> ${createQuoteDto.contactNumber2}</p>` : ''}
          ${createQuoteDto.company ? `<p><strong>Company:</strong> ${createQuoteDto.company}</p>` : ''}
          <p><strong>Service Type:</strong> ${createQuoteDto.serviceType}</p>
          <p><strong>Budget:</strong> ${createQuoteDto.budget}</p>
          <p><strong>Description:</strong></p>
          <p>${createQuoteDto.description}</p>
        `,
      });

      if (emailError) {
        console.error('Error sending quote email:', emailError);
        // We don't throw here to avoid failing the request if only email fails, but we log it.
      }
    } catch (emailEx) {
      console.error('Exception sending quote email:', emailEx);
    }

    return { message: 'Quote request submitted successfully' };
  }
}
