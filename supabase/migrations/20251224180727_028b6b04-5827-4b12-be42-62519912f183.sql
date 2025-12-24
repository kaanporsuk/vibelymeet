-- Create app_role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

-- Create user_roles table for proper role management
CREATE TABLE public.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Users can only view their own roles
CREATE POLICY "Users can view own roles" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);

-- Create security definer function to check roles (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Fix matches table: Replace public policy with authenticated user policy
DROP POLICY IF EXISTS "Public can view matches" ON public.matches;

CREATE POLICY "Users can view own matches" ON public.matches
  FOR SELECT USING (auth.uid() = profile_id_1 OR auth.uid() = profile_id_2);

-- Allow authenticated users to create matches
CREATE POLICY "Authenticated users can create matches" ON public.matches
  FOR INSERT WITH CHECK (auth.uid() = profile_id_1 OR auth.uid() = profile_id_2);

-- Fix messages table: Replace public policies with authenticated policies
DROP POLICY IF EXISTS "Public can view messages" ON public.messages;
DROP POLICY IF EXISTS "Public can send messages" ON public.messages;

CREATE POLICY "Users can view messages in own matches" ON public.messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.matches 
      WHERE id = match_id 
      AND (auth.uid() = profile_id_1 OR auth.uid() = profile_id_2)
    )
  );

CREATE POLICY "Users can send messages in own matches" ON public.messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM public.matches 
      WHERE id = match_id 
      AND (auth.uid() = profile_id_1 OR auth.uid() = profile_id_2)
    )
  );

-- Add INSERT policy for events (admin only)
CREATE POLICY "Admins can create events" ON public.events
  FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Add UPDATE policy for events (admin only)
CREATE POLICY "Admins can update events" ON public.events
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));

-- Add DELETE policy for events (admin only)
CREATE POLICY "Admins can delete events" ON public.events
  FOR DELETE USING (public.has_role(auth.uid(), 'admin'));