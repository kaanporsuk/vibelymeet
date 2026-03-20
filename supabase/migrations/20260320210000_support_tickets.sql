-- Support & Feedback: tickets, replies, attachments
-- RLS: users see own rows; admins (has_role) see/manage all.

-- ─── Tables ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  primary_type text NOT NULL CHECK (primary_type IN ('support', 'feedback', 'safety')),
  subcategory text NOT NULL,

  subject text,
  message text NOT NULL,

  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'in_review', 'waiting_on_user', 'resolved')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),

  platform text,
  app_version text,
  device_model text,
  os_version text,
  user_email text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,

  assigned_to text,
  admin_notes text
);

CREATE TABLE IF NOT EXISTS public.support_ticket_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('user', 'admin')),
  sender_id uuid,
  message text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_ticket_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  file_name text,
  file_size integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Unique VB-XXXXX reference (generated per row)
CREATE OR REPLACE FUNCTION public.set_support_ticket_reference_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ref text;
  attempts int := 0;
BEGIN
  IF NEW.reference_id IS NOT NULL AND length(trim(NEW.reference_id)) > 0 THEN
    RETURN NEW;
  END IF;
  LOOP
    ref := 'VB-' || lpad(floor(random() * 99999 + 1)::text, 5, '0');
    IF NOT EXISTS (SELECT 1 FROM public.support_tickets WHERE reference_id = ref) THEN
      NEW.reference_id := ref;
      RETURN NEW;
    END IF;
    attempts := attempts + 1;
    IF attempts > 200 THEN
      RAISE EXCEPTION 'Could not generate unique reference_id';
    END IF;
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS support_tickets_set_reference ON public.support_tickets;
CREATE TRIGGER support_tickets_set_reference
  BEFORE INSERT ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_support_ticket_reference_id();

CREATE OR REPLACE FUNCTION public.update_support_ticket_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_tickets_updated_at ON public.support_tickets;
CREATE TRIGGER support_tickets_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_support_ticket_timestamp();

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_primary_type ON public.support_tickets(primary_type);
CREATE INDEX IF NOT EXISTS idx_support_tickets_updated_at ON public.support_tickets(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_ticket_replies_ticket_id ON public.support_ticket_replies(ticket_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_attachments ENABLE ROW LEVEL SECURITY;

-- Tickets: users
CREATE POLICY "users_select_own_support_tickets"
  ON public.support_tickets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users_insert_own_support_tickets"
  ON public.support_tickets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Tickets: admins
CREATE POLICY "admins_all_support_tickets"
  ON public.support_tickets FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Replies: users (own tickets)
CREATE POLICY "users_select_own_ticket_replies"
  ON public.support_ticket_replies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = ticket_id AND t.user_id = auth.uid()
    )
  );

CREATE POLICY "users_insert_own_user_replies"
  ON public.support_ticket_replies FOR INSERT
  WITH CHECK (
    sender_type = 'user'
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = ticket_id AND t.user_id = auth.uid()
    )
  );

CREATE POLICY "users_update_read_admin_replies"
  ON public.support_ticket_replies FOR UPDATE
  USING (
    sender_type = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = ticket_id AND t.user_id = auth.uid()
    )
  )
  WITH CHECK (
    sender_type = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = ticket_id AND t.user_id = auth.uid()
    )
  );

-- Replies: admins
CREATE POLICY "admins_all_support_ticket_replies"
  ON public.support_ticket_replies FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Attachments: users
CREATE POLICY "users_select_own_ticket_attachments"
  ON public.support_ticket_attachments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = ticket_id AND t.user_id = auth.uid()
    )
  );

CREATE POLICY "users_insert_own_ticket_attachments"
  ON public.support_ticket_attachments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = ticket_id AND t.user_id = auth.uid()
    )
  );

-- Attachments: admins
CREATE POLICY "admins_all_support_ticket_attachments"
  ON public.support_ticket_attachments FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_tickets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_ticket_replies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_ticket_attachments TO authenticated;
