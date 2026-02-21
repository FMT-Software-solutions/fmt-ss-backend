import { Injectable } from '@nestjs/common';
import { SanityService } from '../../common/sanity/sanity.service';
import { ReviewsService } from '../reviews/reviews.service';

export interface Testimonial {
  text: string;
  imageSrc?: string;
  name: string;
  username?: string;
  role?: string;
  rating?: number;
}

@Injectable()
export class TestimonialsService {
  constructor(
    private readonly sanityService: SanityService,
    private readonly reviewsService: ReviewsService,
  ) { }

  async findAll() {
    try {
      // Fetch featured reviews from Supabase
      const reviews = await this.reviewsService.findAllFeatured();

      if (reviews && reviews.length > 0) {
        return reviews.map(review => ({
          text: review.content,
          imageSrc: '', // No images for reviews yet
          name: review.name,
          username: review.company || '',
          role: review.position || '',
          rating: review.rating,
        }));
      }

      // Fallback to Sanity if no featured reviews
      const query = `*[_type == "testimonial"] {
        text,
        "imageSrc": image.asset->url,
        name,
        username,
        role
      }`;
      const testimonials = await this.sanityService.fetch<Testimonial[]>(query);

      if (testimonials && testimonials.length > 0) {
        return testimonials;
      }
    } catch (error) {
      console.warn('Failed to fetch testimonials, returning empty array.', error);
    }
    return [];
  }
}
