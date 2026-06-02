import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { checkRateLimit, createRateLimitResponse } from "../_shared/rate-limiter.ts";
import { fetchWithProviderTimeout, providerFetchTimeoutMs } from "../_shared/provider-fetch.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RATE_LIMIT_REQUESTS = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function cityLevelCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Validate authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client and validate the user
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      console.error('Auth error:', authError?.message);
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { lat, lng } = await req.json();

    // Validate inputs
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return new Response(
        JSON.stringify({ error: 'Latitude and longitude must be finite numbers' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (lat < -90 || lat > 90) {
      return new Response(
        JSON.stringify({ error: `Invalid latitude: ${lat}. Must be between -90 and 90.` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (lng < -180 || lng > 180) {
      return new Response(
        JSON.stringify({ error: `Invalid longitude: ${lng}. Must be between -180 and 180.` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rateResult = await checkRateLimit(user.id, {
      maxRequests: RATE_LIMIT_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
      functionName: 'geocode',
    });
    if (!rateResult.allowed) {
      return createRateLimitResponse(rateResult, corsHeaders);
    }

    const roundedLat = cityLevelCoordinate(lat);
    const roundedLng = cityLevelCoordinate(lng);

    const fallback = { lat: roundedLat, lng: roundedLng, city: 'Unknown', country: 'Unknown', formatted: 'Location detected' };
    let response: Response;
    try {
      // Call Nominatim API from server side (no CORS issues)
      response = await fetchWithProviderTimeout(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${roundedLat}&lon=${roundedLng}&zoom=10&addressdetails=1`,
        {
          headers: {
            'User-Agent': 'Vibely Dating App (support@vibelymeet.com)',
            'Accept': 'application/json',
          },
        },
        {
          provider: 'nominatim',
          operation: 'reverse_geocode',
          timeoutMs: providerFetchTimeoutMs('nominatim', 'reverse_geocode', 5_000),
        },
      );
    } catch (error) {
      console.error('Nominatim API unavailable:', error instanceof Error ? error.message : String(error));
      return new Response(
        JSON.stringify({
          error: 'Geocoding service temporarily unavailable',
          fallback,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!response.ok) {
      console.error('Nominatim API error:', response.status, response.statusText);
      return new Response(
        JSON.stringify({ 
          error: 'Geocoding service temporarily unavailable',
          fallback,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    
    const city = data.address?.city || 
                 data.address?.town || 
                 data.address?.municipality || 
                 data.address?.village ||
                 data.address?.county ||
                 data.address?.state ||
                 'Unknown';
    
    const country = data.address?.country || 'Unknown';
    
    const result = {
      lat: roundedLat,
      lng: roundedLng,
      city,
      country,
      formatted: city !== 'Unknown' ? `${city}, ${country}` : 'Location detected',
    };

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Geocode function error:', error);
    return new Response(
      JSON.stringify({ error: 'Geocoding service unavailable' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
