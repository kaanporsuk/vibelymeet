import { Navigate, useParams, useSearchParams } from "react-router-dom";

/**
 * Short event URL `/event/:eventId?...` → canonical `/events/:id?...` (event detail + ref preserved).
 * Keeps shared links working if they omit the "s" in "events".
 */
export default function EventShortRedirect() {
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const q = searchParams.toString();
  if (!eventId) return <Navigate to="/events" replace />;
  return <Navigate to={`/events/${eventId}${q ? `?${q}` : ""}`} replace />;
}
