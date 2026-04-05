import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  ensureProfileReady as ensureSharedProfileReady,
  type EnsureProfileExistsReason,
  type EnsureProfileFailureCode,
  type EnsureProfileReadyResult,
  type ProfileBootstrapClient,
} from "../../shared/profileBootstrap";

export type {
  EnsureProfileExistsReason,
  EnsureProfileFailureCode,
  EnsureProfileReadyResult,
} from "../../shared/profileBootstrap";

export async function ensureProfileReady(
  user: User,
  reason: EnsureProfileExistsReason,
): Promise<EnsureProfileReadyResult> {
  return ensureSharedProfileReady(
    supabase as unknown as ProfileBootstrapClient,
    user,
    reason,
  );
}
