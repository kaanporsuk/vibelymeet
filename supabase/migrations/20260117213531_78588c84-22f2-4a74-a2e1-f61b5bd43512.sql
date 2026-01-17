-- Create admin notifications table
CREATE TABLE public.admin_notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type text NOT NULL, -- 'new_user', 'new_match', 'event_full', 'user_report', 'user_suspended'
    title text NOT NULL,
    message text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb,
    read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS on admin_notifications
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

-- Only admins can view/manage notifications
CREATE POLICY "Admins can view admin notifications"
    ON public.admin_notifications FOR SELECT
    USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update admin notifications"
    ON public.admin_notifications FOR UPDATE
    USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete admin notifications"
    ON public.admin_notifications FOR DELETE
    USING (has_role(auth.uid(), 'admin'));

-- System can insert notifications (for triggers)
CREATE POLICY "System can insert notifications"
    ON public.admin_notifications FOR INSERT
    WITH CHECK (true);

-- Create user suspensions table
CREATE TABLE public.user_suspensions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    suspended_by uuid NOT NULL,
    reason text NOT NULL,
    suspended_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone, -- NULL = permanent
    lifted_at timestamp with time zone,
    lifted_by uuid,
    status text DEFAULT 'active' CHECK (status IN ('active', 'lifted', 'expired'))
);

-- Enable RLS on user_suspensions
ALTER TABLE public.user_suspensions ENABLE ROW LEVEL SECURITY;

-- Only admins can manage suspensions
CREATE POLICY "Admins can view all suspensions"
    ON public.user_suspensions FOR SELECT
    USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can create suspensions"
    ON public.user_suspensions FOR INSERT
    WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update suspensions"
    ON public.user_suspensions FOR UPDATE
    USING (has_role(auth.uid(), 'admin'));

-- Create user warnings table
CREATE TABLE public.user_warnings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    issued_by uuid NOT NULL,
    reason text NOT NULL,
    message text NOT NULL,
    acknowledged_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS on user_warnings
ALTER TABLE public.user_warnings ENABLE ROW LEVEL SECURITY;

-- Admins can manage warnings
CREATE POLICY "Admins can view all warnings"
    ON public.user_warnings FOR SELECT
    USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can create warnings"
    ON public.user_warnings FOR INSERT
    WITH CHECK (has_role(auth.uid(), 'admin'));

-- Users can view own warnings
CREATE POLICY "Users can view own warnings"
    ON public.user_warnings FOR SELECT
    USING (auth.uid() = user_id);

-- Users can acknowledge warnings
CREATE POLICY "Users can acknowledge own warnings"
    ON public.user_warnings FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Function to create admin notification on new user signup
CREATE OR REPLACE FUNCTION public.notify_admin_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.admin_notifications (type, title, message, data)
    VALUES (
        'new_user',
        'New User Signup',
        format('A new user "%s" has joined the platform.', NEW.name),
        jsonb_build_object('user_id', NEW.id, 'name', NEW.name, 'gender', NEW.gender)
    );
    RETURN NEW;
END;
$$;

-- Trigger for new user notifications
CREATE TRIGGER on_new_user_notify_admin
    AFTER INSERT ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.notify_admin_new_user();

-- Function to create admin notification on new match
CREATE OR REPLACE FUNCTION public.notify_admin_new_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    user1_name text;
    user2_name text;
BEGIN
    SELECT name INTO user1_name FROM public.profiles WHERE id = NEW.profile_id_1;
    SELECT name INTO user2_name FROM public.profiles WHERE id = NEW.profile_id_2;
    
    INSERT INTO public.admin_notifications (type, title, message, data)
    VALUES (
        'new_match',
        'New Match Created',
        format('Users "%s" and "%s" have matched!', user1_name, user2_name),
        jsonb_build_object('match_id', NEW.id, 'user1_id', NEW.profile_id_1, 'user2_id', NEW.profile_id_2)
    );
    RETURN NEW;
END;
$$;

-- Trigger for new match notifications
CREATE TRIGGER on_new_match_notify_admin
    AFTER INSERT ON public.matches
    FOR EACH ROW
    EXECUTE FUNCTION public.notify_admin_new_match();

-- Function to notify when event is full
CREATE OR REPLACE FUNCTION public.notify_admin_event_full()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.current_attendees >= NEW.max_attendees AND 
       (OLD.current_attendees IS NULL OR OLD.current_attendees < OLD.max_attendees) THEN
        INSERT INTO public.admin_notifications (type, title, message, data)
        VALUES (
            'event_full',
            'Event at Full Capacity',
            format('Event "%s" has reached maximum capacity.', NEW.title),
            jsonb_build_object('event_id', NEW.id, 'title', NEW.title, 'attendees', NEW.current_attendees)
        );
    END IF;
    RETURN NEW;
END;
$$;

-- Trigger for event full notifications
CREATE TRIGGER on_event_full_notify_admin
    AFTER UPDATE ON public.events
    FOR EACH ROW
    EXECUTE FUNCTION public.notify_admin_event_full();

-- Add is_suspended column to profiles for quick check
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_suspended boolean DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS suspension_reason text;