-- Admin website data managers (MAIN project)
-- Run this in the main FMT Supabase project's SQL editor.

-- messages.status already means "did the notification email send"
-- (pending / sent / failed, set by ContactService). Read state is a separate
-- concern, so it gets its own column rather than overloading that one.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Admin list views are sorted newest-first and filtered by unread.
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON public.messages (created_at DESC);
CREATE INDEX IF NOT EXISTS messages_read_at_idx ON public.messages (read_at);

-- Common sort/filter paths for the other admin lists.
CREATE INDEX IF NOT EXISTS quotes_created_at_idx ON public.quotes (created_at DESC);
CREATE INDEX IF NOT EXISTS reviews_created_at_idx ON public.reviews (created_at DESC);
CREATE INDEX IF NOT EXISTS reviews_status_idx ON public.reviews (status);
CREATE INDEX IF NOT EXISTS purchases_created_at_idx ON public.purchases (created_at DESC);
CREATE INDEX IF NOT EXISTS purchases_status_idx ON public.purchases (status);
CREATE INDEX IF NOT EXISTS issues_created_at_idx ON public.issues (created_at DESC);
CREATE INDEX IF NOT EXISTS newsletter_subscribers_created_at_idx
  ON public.newsletter_subscribers (created_at DESC);
