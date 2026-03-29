/**
 * Pulls the current subscriber state from RevenueCat REST API and upserts
 * the revenuecat subscriptions row (+ profile tier). Called after native restore
 * so the DB updates without waiting for webhooks.
 *
 * Secrets: REVENUECAT_SECRET_API_KEY (Project Settings → API keys → Secret API key in RC dashboard).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  pickActiveEntitlementFromSubscriberPayload,
  upsertActiveRevenueCatSubscription,
  downgradeRevenueCatSubscriptionRow,
} from '../_shared/revenuecatSubscription.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceKey)

    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
    if (authError || !user) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const rcSecret = Deno.env.get('REVENUECAT_SECRET_API_KEY')?.trim()
    if (!rcSecret) {
      return new Response(JSON.stringify({ success: true, synced: false, reason: 'revenuecat_secret_not_configured' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const url = `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(user.id)}`
    const rcRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${rcSecret}`,
        'Content-Type': 'application/json',
      },
    })

    if (rcRes.status === 404) {
      const { error } = await downgradeRevenueCatSubscriptionRow(supabase, user.id, 'EXPIRATION', null)
      if (error) {
        return new Response(JSON.stringify({ success: false, error }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ success: true, synced: true, active: false }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!rcRes.ok) {
      const text = await rcRes.text()
      return new Response(JSON.stringify({ success: false, error: `revenuecat_api_${rcRes.status}`, detail: text.slice(0, 200) }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = (await rcRes.json()) as Record<string, unknown>
    const subscriber = body.subscriber as Record<string, unknown> | undefined
    const originalAppUserId = (subscriber?.original_app_user_id as string | undefined) ?? null

    const picked = pickActiveEntitlementFromSubscriberPayload(body)
    if (!picked) {
      const { error } = await downgradeRevenueCatSubscriptionRow(supabase, user.id, 'EXPIRATION', null)
      if (error) {
        return new Response(JSON.stringify({ success: false, error }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ success: true, synced: true, active: false }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const expirationAtMs =
      picked.expirationAtMs != null && !Number.isNaN(picked.expirationAtMs) ? picked.expirationAtMs : null

    const { error } = await upsertActiveRevenueCatSubscription(supabase, user.id, {
      productId: picked.productId,
      expirationAtMs,
      periodType: picked.periodType ?? null,
      originalAppUserId,
    })
    if (error) {
      return new Response(JSON.stringify({ success: false, error }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(
      JSON.stringify({ success: true, synced: true, active: true, product_id: picked.productId }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
