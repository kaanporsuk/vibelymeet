import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, createRateLimitResponse } from "../_shared/rate-limiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RATE_LIMIT_REQUESTS = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

async function canUsePremiumGeocode(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
): Promise<boolean> {
  const { data: adminRows } = await supabaseAdmin
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .limit(1);
  if ((adminRows?.length ?? 0) > 0) return true;

  const { data: premium, error } = await supabaseAdmin.rpc("check_premium_status", {
    p_user_id: userId,
  });
  if (error) {
    console.error("check_premium_status (forward-geocode):", error);
    return false;
  }
  return !!premium;
}

type NominatimItem = {
  lat: string;
  lon: string;
  display_name?: string;
  class?: string;
  type?: string;
  address?: Record<string, string>;
};

const PLACE_TYPES = new Set([
  "city",
  "town",
  "village",
  "hamlet",
  "municipality",
  "administrative",
]);

function pickCityName(addr: Record<string, string>): string {
  return (
    addr.city ||
    addr.town ||
    addr.village ||
    addr.municipality ||
    addr.hamlet ||
    addr.county ||
    ""
  ).trim();
}

function pickRegion(addr: Record<string, string>): string {
  return (addr.state || addr.region || addr.state_district || "").trim();
}

function isSettlementLike(item: NominatimItem): boolean {
  const c = item.class;
  const t = (item.type || "").toLowerCase();
  if (c === "place" && PLACE_TYPES.has(t)) return true;
  if (c === "boundary" && (t === "administrative" || t === "political")) {
    const a = item.address || {};
    return !!(pickCityName(a) || a.city || a.town || a.village);
  }
  return false;
}

function normalizeResults(raw: NominatimItem[], _queryFallback: string): Array<{
  lat: number;
  lng: number;
  city: string;
  country: string;
  region: string;
  display_name: string;
}> {
  const seen = new Set<string>();
  const out: Array<{
    lat: number;
    lng: number;
    city: string;
    country: string;
    region: string;
    display_name: string;
  }> = [];

  for (const item of raw) {
    if (!isSettlementLike(item)) continue;
    const addr = item.address || {};
    const city = pickCityName(addr);
    if (!city) continue;
    const country = (addr.country || "").trim();
    const region = pickRegion(addr);
    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const dedupeKey = [
      city.toLowerCase(),
      region.toLowerCase(),
      country.toLowerCase(),
      Math.round(lat * 100) / 100,
      Math.round(lng * 100) / 100,
    ].join("|");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const line2 = [region, country].filter(Boolean).join(", ");
    const display_name = line2 ? `${city}, ${line2}` : city;

    out.push({
      lat,
      lng,
      city,
      country,
      region,
      display_name,
    });
    if (out.length >= 8) break;
  }

  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const allowed = await canUsePremiumGeocode(supabaseAdmin, user.id);
    if (!allowed) {
      return new Response(JSON.stringify({ error: "Premium subscription required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rateResult = await checkRateLimit(user.id, {
      maxRequests: RATE_LIMIT_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
      functionName: "forward-geocode",
    }, supabaseAdmin);
    if (!rateResult.allowed) {
      return createRateLimitResponse(rateResult, corsHeaders);
    }

    const { query } = await req.json();

    if (!query || query.trim().length < 2) {
      return new Response(JSON.stringify([]), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const q = query.trim();
    const encoded = encodeURIComponent(q);
    // Settlement-focused search (cities/towns/villages), not street/POI-first
    const url =
      `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=15&addressdetails=1&featuretype=settlement`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "ViblyApp/1.0 (contact@vibelymeet.com)",
        "Accept-Language": "en",
      },
    });

    if (!response.ok) {
      throw new Error(`Nominatim error: ${response.status}`);
    }

    const data = (await response.json()) as NominatimItem[];
    const results = normalizeResults(Array.isArray(data) ? data : [], q);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Forward geocode error:", error);
    return new Response(JSON.stringify({ error: "Geocoding failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
