import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, createRateLimitResponse } from "../_shared/rate-limiter.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RATE_LIMIT_REQUESTS = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
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

    // Allow admin users OR premium subscribers
    const { data: roleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("is_premium")
        .eq("id", user.id)
        .single();
      if (!profile?.is_premium) {
        return new Response(JSON.stringify({ error: "Premium subscription required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const encoded = encodeURIComponent(query.trim());
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=5&addressdetails=1`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ViblyApp/1.0 (contact@vibelymeet.com)',
        'Accept-Language': 'en',
      },
    });

    if (!response.ok) {
      throw new Error(`Nominatim error: ${response.status}`);
    }

    const data = await response.json();

    const results = data.map((item: any) => {
      const addr = item.address || {};
      const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || query;
      const country = addr.country || '';

      return {
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        city,
        country,
        display_name: item.display_name,
      };
    });

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Forward geocode error:', error);
    return new Response(JSON.stringify({ error: 'Geocoding failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
