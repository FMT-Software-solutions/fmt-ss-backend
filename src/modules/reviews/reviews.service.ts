import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly supabaseService: SupabaseService) { }

  async create(createReviewDto: CreateReviewDto) {
    const supabase = this.supabaseService.getClient();

    const { error } = await supabase
      .from('reviews').insert([{ ...createReviewDto, status: 'pending' }]);

    if (error) {
      console.error('Error creating review:', error);
      throw new InternalServerErrorException('Failed to submit review');
    }

    return { message: 'Review submitted successfully and is pending approval.' };
  }

  async findAllFeatured() {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('reviews')
      .select('*')
      .eq('is_featured', true)
      .eq('status', 'approved')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching featured reviews:', error);
      throw new InternalServerErrorException('Failed to fetch reviews');
    }

    return data;
  }

  async findAllByApp(appId: string) {
    const supabase = this.supabaseService.getClient();

    // Use maybeSingle() or check count to debug if needed, but select('*') returns an array
    const { data, error } = await supabase
      .from('reviews')
      .select('*')
      .eq('app_id', appId)
      .eq('status', 'approved')
      .order('created_at', { ascending: false });

    if (error) {
      console.error(`Error fetching reviews for app ${appId}:`, error);
      throw new InternalServerErrorException('Failed to fetch reviews');
    }

    // Explicitly return data or empty array
    return data || [];
  }
}
