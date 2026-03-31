import { Navigate, useSearchParams } from "react-router-dom";

/** Marketing URL `/invite?ref=` → signup with referral preserved (matches native share links). */
export default function InviteRedirect() {
  const [searchParams] = useSearchParams();
  const ref = searchParams.get("ref");
  const next = ref ? `/auth?ref=${encodeURIComponent(ref)}` : "/auth";
  return <Navigate to={next} replace />;
}
