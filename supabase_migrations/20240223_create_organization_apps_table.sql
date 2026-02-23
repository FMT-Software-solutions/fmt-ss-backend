-- Create organization_apps table to track which apps an organization has access to
CREATE TABLE IF NOT EXISTS public.organization_apps (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    app_id TEXT NOT NULL, -- This corresponds to the Sanity product ID (string)
    status TEXT NOT NULL DEFAULT 'active', -- 'active', 'trial', 'expired', 'cancelled'
    plan_type TEXT DEFAULT 'premium', -- 'premium', 'trial', 'free'
    access_granted_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ, -- Useful for trials or subscriptions
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure an organization can only have one active record per app (optional, but good for data integrity)
    -- We might want to allow multiple if they buy multiple licenses, but typically "access" is binary.
    -- For now, let's enforce uniqueness on org_id + app_id to prevent duplicates as requested.
    UNIQUE(organization_id, app_id)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_organization_apps_org_id ON public.organization_apps(organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_apps_app_id ON public.organization_apps(app_id);

-- Add RLS policies (optional, depending on your auth model, but good practice)
ALTER TABLE public.organization_apps ENABLE ROW LEVEL SECURITY;

-- Allow service role (backend) full access
CREATE POLICY "Service role has full access" ON public.organization_apps
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
