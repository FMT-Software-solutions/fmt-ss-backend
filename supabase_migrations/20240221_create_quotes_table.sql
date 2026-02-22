
-- Create quotes table
CREATE TABLE public.quotes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  contact_number_1 TEXT NOT NULL,
  contact_number_2 TEXT,
  company TEXT,
  service_type TEXT NOT NULL,
  budget TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'confirmed', 'reviewing', 'pending-customer-feedback', 'completed', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add RLS policies (optional but recommended)
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;

-- Allow public insert (for submitting quotes)
CREATE POLICY "Anyone can insert quotes" 
ON public.quotes FOR INSERT 
WITH CHECK (true);

-- Only authenticated users (admin) can view quotes (adjust based on auth setup)
-- Assuming we want to keep quotes private by default
CREATE POLICY "Authenticated users can view quotes" 
ON public.quotes FOR SELECT 
TO authenticated
USING (true);
