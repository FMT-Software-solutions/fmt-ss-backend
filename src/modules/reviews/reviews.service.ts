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
}
