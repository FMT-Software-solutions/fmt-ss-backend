import { Injectable, BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { SanityService } from '../../common/sanity/sanity.service';
import { ResendService } from '../../common/resend/resend.service';
import { RegisterTrainingDto } from './dto/register-training.dto';
import { Database } from '../../common/supabase/database.types';

type TrainingRegistrationInsert = Database['public']['Tables']['training_registrations']['Insert'];

@Injectable()
export class TrainingService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly sanityService: SanityService,
    private readonly resendService: ResendService,
  ) {}

  async register(registerDto: RegisterTrainingDto) {
    const { trainingSlug, firstName, lastName, email, phone, company, message } = registerDto;
    
    // 1. Fetch training from Sanity
    // We use a query that includes necessary fields for registration logic
    const query = `*[_type == "training" && slug.current == $slug][0] {
      _id,
      title,
      slug,
      price,
      isFree,
      maxParticipants,
      registeredParticipants,
      startDate,
      "slug": slug.current
    }`;
    
    const training = await this.sanityService.fetch<any>(query, { slug: trainingSlug });

    if (!training) {
      throw new NotFoundException('Training program not found');
    }

    // 2. Check capacity
    if (
      training.maxParticipants &&
      (training.registeredParticipants || 0) >= training.maxParticipants
    ) {
      throw new BadRequestException('Registration is closed. Maximum participants reached.');
    }

    const supabase: any = this.supabaseService.getClient();

    // 3. Handle Paid Training
    if (!training.isFree) {
      const insertData: TrainingRegistrationInsert = {
        training_id: training._id,
        training_slug: training.slug,
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        company: company || null,
        message: message || null,
        status: 'pending',
      };

      const { data, error: dbError } = await supabase
        .from('training_registrations')
        .insert(insertData)
        .select()
        .single();

      if (dbError) {
        console.error('Error saving registration:', dbError);
        throw new InternalServerErrorException('Failed to save registration');
      }

      return {
        success: true,
        requiresPayment: true,
        registrationId: data.id,
        amount: training.price,
        registrationData: data,
        training: training, // Return basic training info
      };
    }

    // 4. Handle Free Training
    const insertData: TrainingRegistrationInsert = {
      training_id: training._id,
      training_slug: training.slug,
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      company: company || null,
      message: message || null,
      status: 'confirmed',
    };

    const { data, error: dbError } = await supabase
      .from('training_registrations')
      .insert(insertData)
      .select()
      .single();

    if (dbError) {
      console.error('Error saving registration:', dbError);
      throw new InternalServerErrorException('Failed to save registration');
    }

    // Update Sanity Participant Count
    try {
      await this.sanityService.getClient()
        .patch(training._id)
        .inc({ registeredParticipants: 1 })
        .commit();
    } catch (sanityError) {
      console.error('Error updating Sanity document:', sanityError);
      // Try to set if not exists (fallback logic from legacy)
      try {
         await this.sanityService.getClient()
          .patch(training._id)
          .setIfMissing({ registeredParticipants: 0 })
          .inc({ registeredParticipants: 1 })
          .commit();
      } catch (e) {
          console.error('Failed to update participant count', e);
      }
    }

    // Send Confirmation Email
    try {
        await this.resendService.sendEmail({
          from: 'training@fmtsoftware.com',
          to: email,
          subject: `Registration Confirmation: ${training.title}`,
          html: `
            <h1>Registration Confirmed</h1>
            <p>Dear ${firstName},</p>
            <p>You have successfully registered for <strong>${training.title}</strong>.</p>
            <p>We look forward to seeing you!</p>
          `,
        });
    } catch (emailError) {
        console.error('Error sending confirmation email:', emailError);
        // We don't fail the request if email fails, but we should log it (TODO: IssuesModule)
    }

    return {
      success: true,
      requiresPayment: false,
      registrationId: data.id,
      message: 'Registration successful',
    };
  }
}
