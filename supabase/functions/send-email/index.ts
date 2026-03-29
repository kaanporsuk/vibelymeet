import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'Vibely <hello@vibelymeet.com>'
const APP_URL = Deno.env.get('APP_URL') || 'https://vibelymeet.com'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface EmailRequest {
  to: string
  subject?: string
  html?: string
  template?: 'welcome' | 'new_match' | 'event_confirmation' | 'deletion_scheduled'
  data?: Record<string, string>
}

const TEMPLATES: Record<
  'welcome' | 'new_match',
  (data: Record<string, string>) => { subject: string; html: string }
> = {
  welcome: (d) => ({
    subject: `Welcome to Vibely, ${d.name || 'there'}! 🎉`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #e5e5e5; padding: 40px 24px; border-radius: 16px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #8B5CF6; font-size: 28px; margin: 0;">Welcome to Vibely</h1>
        </div>
        <p style="font-size: 16px; line-height: 1.6;">Hey ${d.name || 'there'},</p>
        <p style="font-size: 16px; line-height: 1.6;">You're in! Vibely is where real connections happen — through video dates at live events.</p>
        <p style="font-size: 16px; line-height: 1.6;">Here's how to get started:</p>
        <ul style="font-size: 15px; line-height: 1.8; color: #a3a3a3;">
          <li><strong style="color: #e5e5e5;">Complete your profile</strong> — add photos and a Vibe Video</li>
          <li><strong style="color: #e5e5e5;">Browse events</strong> — find ones that match your vibe</li>
          <li><strong style="color: #e5e5e5;">Start swiping</strong> — mutual vibes lead to video dates</li>
        </ul>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${APP_URL}" style="background: linear-gradient(135deg, #8B5CF6, #E84393); color: white; padding: 14px 32px; border-radius: 99px; text-decoration: none; font-weight: 600; font-size: 16px;">Open Vibely</a>
        </div>
        <p style="font-size: 13px; color: #737373; text-align: center;">You're receiving this because you signed up for Vibely.</p>
      </div>
    `,
  }),

  new_match: () => ({
    subject: "You have a new match on Vibely! 🎉",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #e5e5e5; padding: 40px 24px; border-radius: 16px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #E84393; font-size: 28px; margin: 0;">It's a match! 🎉</h1>
        </div>
        <p style="font-size: 16px; line-height: 1.6;">Great news — you and someone both vibed!</p>
        <p style="font-size: 16px; line-height: 1.6;">Open Vibely to start chatting and plan a video date.</p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${APP_URL}/matches" style="background: linear-gradient(135deg, #8B5CF6, #E84393); color: white; padding: 14px 32px; border-radius: 99px; text-decoration: none; font-weight: 600; font-size: 16px;">See Your Match</a>
        </div>
        <p style="font-size: 13px; color: #737373; text-align: center;">You're receiving this because you have notifications enabled on Vibely.</p>
      </div>
    `,
  }),
}

function normalizeEmail(s: string): string {
  return s.trim().toLowerCase()
}

/** Role claim from JWT payload (base64url). */
function jwtPayloadRole(token: string): string | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const mid = parts[1]
    const b64 = mid.replace(/-/g, '+').replace(/_/g, '/')
    const pad = (4 - (b64.length % 4)) % 4
    const json = JSON.parse(atob(b64 + '='.repeat(pad)))
    return typeof json?.role === 'string' ? json.role : null
  } catch {
    return null
  }
}

async function authorizeRequest(
  req: Request,
  body: EmailRequest,
): Promise<{ ok: true; isServiceRole: boolean } | { ok: false; message: string }> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, message: 'Unauthorized' }
  }
  const token = authHeader.slice('Bearer '.length)
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  if (token === serviceKey || jwtPayloadRole(token) === 'service_role') {
    return { ok: true, isServiceRole: true }
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userRes, error } = await userClient.auth.getUser()
  if (error || !userRes?.user?.email) {
    return { ok: false, message: 'Unauthorized' }
  }
  if (body.template !== 'welcome') {
    return { ok: false, message: 'Forbidden' }
  }
  if (normalizeEmail(body.to) !== normalizeEmail(userRes.user.email)) {
    return { ok: false, message: 'Forbidden' }
  }
  if (body.subject != null || body.html != null) {
    return { ok: false, message: 'Forbidden' }
  }
  return { ok: true, isServiceRole: false }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    let body: EmailRequest
    try {
      body = (await req.json()) as EmailRequest
    } catch {
      return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const auth = await authorizeRequest(req, body)
    if (!auth.ok) {
      return new Response(JSON.stringify({ success: false, error: auth.message }), {
        status: auth.message === 'Forbidden' ? 403 : 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { to, subject, html, template, data } = body

    let finalSubject = subject
    let finalHtml = html

    if (template) {
      const renderer = TEMPLATES[template as keyof typeof TEMPLATES]
      if (!renderer) {
        return new Response(
          JSON.stringify({ success: false, error: 'Unknown template' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
      const rendered = renderer(data || {})
      finalSubject = rendered.subject
      finalHtml = rendered.html
    }

    if (!to || !finalSubject || !finalHtml) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing to, subject, or html' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (!RESEND_API_KEY) {
      console.warn('send-email: RESEND_API_KEY not set, skipping')
      return new Response(
        JSON.stringify({ success: false, error: 'Email not configured' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject: finalSubject,
        html: finalHtml,
      }),
    })

    const text = await res.text()
    let result: unknown
    try {
      result = text ? JSON.parse(text) : {}
    } catch {
      result = { raw: text }
    }

    if (!res.ok) {
      console.error('Resend error:', result)
      return new Response(JSON.stringify({ success: false, error: result }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const id = typeof result === 'object' && result !== null && 'id' in result
      ? (result as { id: string }).id
      : undefined
    console.log('send-email:', id || 'sent')
    return new Response(JSON.stringify({ success: true, id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('send-email error:', e)
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
