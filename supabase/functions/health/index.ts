/**
 * Lightweight reachability probe for connectivity banners (HEAD/GET → 200).
 * Deploy: supabase functions deploy health --no-verify-jwt
 */
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve((req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  return new Response('ok', {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
      ...corsHeaders,
    },
  })
})
