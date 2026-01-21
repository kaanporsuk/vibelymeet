-- Create a function to check capacity and create admin notifications
CREATE OR REPLACE FUNCTION public.notify_admin_event_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    capacity_percent numeric;
    event_title text;
BEGIN
    -- Only trigger on INSERT to event_registrations
    IF TG_OP = 'INSERT' THEN
        -- Get event details
        SELECT title, 
               CASE 
                   WHEN max_attendees > 0 THEN (current_attendees::numeric / max_attendees::numeric) * 100
                   ELSE 0
               END
        INTO event_title, capacity_percent
        FROM public.events
        WHERE id = NEW.event_id;

        -- Check if we just hit 80% capacity
        IF capacity_percent >= 80 AND capacity_percent < 85 THEN
            INSERT INTO public.admin_notifications (type, title, message, data)
            VALUES (
                'event_capacity_warning',
                'Event Filling Up',
                format('Event "%s" has reached 80%% capacity!', event_title),
                jsonb_build_object('event_id', NEW.event_id, 'capacity_percent', round(capacity_percent))
            );
        END IF;
        
        -- Check if we just hit 100% capacity (handled by existing trigger but let's add notification)
        -- The existing notify_admin_event_full trigger handles 100%
    END IF;
    
    RETURN NEW;
END;
$function$;

-- Create trigger for capacity alerts
DROP TRIGGER IF EXISTS trigger_event_capacity_alert ON public.event_registrations;
CREATE TRIGGER trigger_event_capacity_alert
AFTER INSERT ON public.event_registrations
FOR EACH ROW
EXECUTE FUNCTION public.notify_admin_event_capacity();