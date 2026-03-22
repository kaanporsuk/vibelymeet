import { Navigate, useSearchParams } from "react-router-dom";

/** Marketing URL `/invite?ref=` → signup with referral preserved (matches native share links). */
export default function InviteRedirect() {
  const [searchParams] = useSearchParams();
  const ref = searchParams.get("ref");
  const next = ref
    ? `/auth?mode=signup&ref=${encodeURIComponent(ref)}`
    : "/auth?mode=signup";
  return <Navigate to={next} replace />;
}
