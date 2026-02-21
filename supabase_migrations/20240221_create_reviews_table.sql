
-- Create reviews table
CREATE TABLE public.reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('general', 'app-specific')),
  app_id TEXT,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  content TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  position TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add RLS policies (optional but recommended)
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- Allow public read access to approved and featured reviews (for testimonials)
CREATE POLICY "Public reviews are viewable by everyone" 
ON public.reviews FOR SELECT 
USING (status = 'approved' AND is_featured = true);

-- Allow public insert (for submitting reviews)
CREATE POLICY "Anyone can insert reviews" 
ON public.reviews FOR INSERT 
WITH CHECK (true);
