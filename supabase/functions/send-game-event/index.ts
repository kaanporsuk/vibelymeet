/**
 * Persist Vibe Arcade game events (append-only). Sync validation rules with shared/vibely-games/.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-client-request-id",
};

const SCHEMA = "vibely.game_event";
const VERSION = 1;
const MESSAGE_KIND = "vibe_game";

const MAX_STATEMENT = 200;
const MAX_OPTION = 300;
const MAX_PROMPT = 300;
const MAX_ANSWER = 500;
const MAX_GUESS = 500;
const MAX_QUESTION = 400;
const MAX_EMOJI_ENTRY = 40;
const MAX_EMOJIS = 24;
const MAX_URL = 2048;

const GAME_TYPES = new Set([
  "2truths",
  "would_rather",
  "charades",
  "scavenger",
  "roulette",
  "intuition",
]);

const PARTNER_EVENTS = new Set([
  "two_truths_guess",
  "would_rather_vote",
  "charades_guess",
  "scavenger_photo",
  "roulette_answer",
  "intuition_result",
]);

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
}

function noHtml(s: string): boolean {
  return !/[<>]/.test(s);
}

function isSafeUrl(s: string): boolean {
  if (typeof s !== "string" || s.length > MAX_URL) return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeGuess(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function charadesMatch(answer: string, guess: string): boolean {
  const a = normalizeGuess(answer);
  const g = normalizeGuess(guess);
  if (!a || !g) return false;
  return a === g || a.includes(g) || g.includes(a);
}

function contentLabel(gameType: string, eventType: string): string {
  const names: Record<string, string> = {
    "2truths": "Two Truths",
    would_rather: "Would You Rather",
    charades: "Emoji Charades",
    scavenger: "Scavenger Hunt",
    roulette: "Vibe Roulette",
    intuition: "Intuition",
  };
  const g = names[gameType] ?? "Game";
  if (eventType === "session_start") return `🎮 ${g}`;
  if (eventType === "session_complete") return `🎮 ${g} · finished`;
  return `🎮 ${g} · update`;
}

type SessionRow = {
  id: string;
  match_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  message_kind: string;
  structured_payload: Record<string, unknown>;
};

async function loadSessionRows(
  serviceClient: ReturnType<typeof createClient>,
  matchId: string,
  gameSessionId: string,
): Promise<SessionRow[]> {
  const { data, error } = await serviceClient
    .from("messages")
    .select("id, match_id, sender_id, content, created_at, message_kind, structured_payload")
    .eq("match_id", matchId)
    .eq("message_kind", MESSAGE_KIND)
    .order("created_at", { ascending: true });

  if (error || !data) return [];
  return (data as SessionRow[]).filter(
    (r) =>
      (r.structured_payload as { game_session_id?: string })?.game_session_id ===
      gameSessionId,
  );
}

function maxEventIndex(rows: SessionRow[]): number {
  let m = -1;
  for (const r of rows) {
    const idx = Number((r.structured_payload as { event_index?: number }).event_index);
    if (Number.isFinite(idx) && idx > m) m = idx;
  }
  return m;
}

function hasSessionComplete(rows: SessionRow[]): boolean {
  return rows.some(
    (r) =>
      (r.structured_payload as { event_type?: string }).event_type ===
      "session_complete",
  );
}

function sessionStarterId(rows: SessionRow[]): string | null {
  const start = rows.find(
    (r) =>
      (r.structured_payload as { event_type?: string }).event_type === "session_start",
  );
  return start?.sender_id ?? null;
}

function validatePayload(
  gameType: string,
  eventType: string,
  payload: unknown,
): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string } {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "invalid_payload" };
  }
  const p = payload as Record<string, unknown>;

  const str = (k: string, max: number, required = true): string | null => {
    const v = p[k];
    if (v === undefined || v === null) return required ? null : "";
    if (typeof v !== "string") return null;
    const t = v.trim();
    if (required && !t) return null;
    if (t.length > max) return null;
    if (!noHtml(t)) return null;
    return t;
  };

  if (eventType === "session_start") {
    if (gameType === "2truths") {
      const st = p.statements;
      if (!Array.isArray(st) || st.length !== 3) return { ok: false, error: "invalid_statements" };
      const statements: string[] = [];
      for (const x of st) {
        if (typeof x !== "string") return { ok: false, error: "invalid_statements" };
        const t = x.trim();
        if (!t || t.length > MAX_STATEMENT || !noHtml(t)) return { ok: false, error: "invalid_statements" };
        statements.push(t);
      }
      const li = p.lie_index;
      if (li !== 0 && li !== 1 && li !== 2) return { ok: false, error: "invalid_lie_index" };
      return { ok: true, payload: { statements, lie_index: li } };
    }
    if (gameType === "would_rather") {
      const a = str("option_a", MAX_OPTION);
      const b = str("option_b", MAX_OPTION);
      const sv = p.sender_vote;
      if (!a || !b || (sv !== "A" && sv !== "B")) return { ok: false, error: "invalid_would_rather_start" };
      return { ok: true, payload: { option_a: a, option_b: b, sender_vote: sv } };
    }
    if (gameType === "charades") {
      const answer = str("answer", MAX_ANSWER);
      const emojis = p.emojis;
      if (!answer) return { ok: false, error: "invalid_charades_start" };
      if (!Array.isArray(emojis) || emojis.length === 0 || emojis.length > MAX_EMOJIS) {
        return { ok: false, error: "invalid_emojis" };
      }
      const em: string[] = [];
      for (const e of emojis) {
        if (typeof e !== "string") return { ok: false, error: "invalid_emojis" };
        if (e.length > MAX_EMOJI_ENTRY || !noHtml(e)) return { ok: false, error: "invalid_emojis" };
        em.push(e);
      }
      return { ok: true, payload: { answer, emojis: em } };
    }
    if (gameType === "scavenger") {
      const prompt = str("prompt", MAX_PROMPT);
      const url = p.sender_photo_url;
      if (!prompt || typeof url !== "string" || !isSafeUrl(url)) {
        return { ok: false, error: "invalid_scavenger_start" };
      }
      return { ok: true, payload: { prompt, sender_photo_url: url } };
    }
    if (gameType === "roulette") {
      const q = str("question", MAX_QUESTION);
      const sa = str("sender_answer", MAX_ANSWER);
      if (!q || !sa) return { ok: false, error: "invalid_roulette_start" };
      return { ok: true, payload: { question: q, sender_answer: sa } };
    }
    if (gameType === "intuition") {
      const opts = p.options;
      if (!Array.isArray(opts) || opts.length !== 2) return { ok: false, error: "invalid_intuition_options" };
      const o0 = typeof opts[0] === "string" ? opts[0].trim() : "";
      const o1 = typeof opts[1] === "string" ? opts[1].trim() : "";
      if (!o0 || !o1 || o0.length > MAX_OPTION || o1.length > MAX_OPTION) {
        return { ok: false, error: "invalid_intuition_options" };
      }
      if (!noHtml(o0) || !noHtml(o1)) return { ok: false, error: "invalid_intuition_options" };
      const sc = p.sender_choice;
      if (sc !== 0 && sc !== 1) return { ok: false, error: "invalid_sender_choice" };
      return { ok: true, payload: { options: [o0, o1], sender_choice: sc } };
    }
    return { ok: false, error: "unsupported_game_start" };
  }

  if (eventType === "two_truths_guess") {
    const gi = p.guess_index;
    if (gi !== 0 && gi !== 1 && gi !== 2) return { ok: false, error: "invalid_guess_index" };
    return { ok: true, payload: { guess_index: gi } };
  }
  if (eventType === "would_rather_vote") {
    const rv = p.receiver_vote;
    if (rv !== "A" && rv !== "B") return { ok: false, error: "invalid_receiver_vote" };
    return { ok: true, payload: { receiver_vote: rv } };
  }
  if (eventType === "charades_guess") {
    const g = str("guess", MAX_GUESS);
    if (!g) return { ok: false, error: "invalid_guess" };
    return { ok: true, payload: { guess: g } };
  }
  if (eventType === "scavenger_photo") {
    const url = p.receiver_photo_url;
    if (typeof url !== "string" || !isSafeUrl(url)) return { ok: false, error: "invalid_photo_url" };
    return { ok: true, payload: { receiver_photo_url: url } };
  }
  if (eventType === "roulette_answer") {
    const ra = str("receiver_answer", MAX_ANSWER);
    if (!ra) return { ok: false, error: "invalid_receiver_answer" };
    return { ok: true, payload: { receiver_answer: ra } };
  }
  if (eventType === "intuition_result") {
    const r = p.result;
    if (r !== "correct" && r !== "wrong") return { ok: false, error: "invalid_intuition_result" };
    return { ok: true, payload: { result: r } };
  }

  if (eventType === "session_complete") {
    return { ok: false, error: "client_session_complete_forbidden" };
  }

  return { ok: false, error: "unknown_event_type" };
}

function shouldEmitComplete(
  gameType: string,
  eventType: string,
  payload: Record<string, unknown>,
  sessionRows: SessionRow[],
): boolean {
  if (eventType === "session_start") return false;
  if (eventType === "two_truths_guess") return true;
  if (eventType === "would_rather_vote") return true;
  if (eventType === "scavenger_photo") return true;
  if (eventType === "roulette_answer") return true;
  if (eventType === "intuition_result") return true;
  if (eventType === "charades_guess") {
    const start = sessionRows.find(
      (r) =>
        (r.structured_payload as { event_type?: string }).event_type === "session_start",
    );
    const answer = (start?.structured_payload as { payload?: { answer?: string } })?.payload
      ?.answer;
    const guess = payload.guess as string;
    if (typeof answer !== "string" || typeof guess !== "string") return false;
    return charadesMatch(answer, guess);
  }
  return false;
}

function completeReason(gameType: string, eventType: string): string {
  return `${gameType}_${eventType}_done`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) {
      return new Response(JSON.stringify({ success: false, error: "invalid_json" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const matchId = body.match_id as string;
    const gameSessionId = body.game_session_id as string;
    const eventIndex = body.event_index;
    const eventType = body.event_type as string;
    const gameType = body.game_type as string;
    const rawPayload = body.payload;
    const clientRequestId =
      (body.client_request_id as string | undefined)?.trim() ||
      req.headers.get("x-client-request-id")?.trim() ||
      undefined;

    const { data: userRes, error: userError } = await userClient.auth.getUser();
    if (userError || !userRes?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const actorId = userRes.user.id;

    if (!matchId || !isUuid(matchId) || !gameSessionId || !isUuid(gameSessionId)) {
      return new Response(JSON.stringify({ success: false, error: "invalid_ids" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (typeof eventIndex !== "number" || !Number.isInteger(eventIndex) || eventIndex < 0) {
      return new Response(JSON.stringify({ success: false, error: "invalid_event_index" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (typeof eventType !== "string" || typeof gameType !== "string") {
      return new Response(JSON.stringify({ success: false, error: "invalid_event_fields" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!GAME_TYPES.has(gameType)) {
      return new Response(JSON.stringify({ success: false, error: "unsupported_game_type" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (eventType === "session_complete") {
      return new Response(
        JSON.stringify({ success: false, error: "client_session_complete_forbidden" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const validated = validatePayload(gameType, eventType, rawPayload);
    if (!validated.ok) {
      return new Response(JSON.stringify({ success: false, error: validated.error }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: match, error: matchError } = await serviceClient
      .from("matches")
      .select("id, profile_id_1, profile_id_2")
      .eq("id", matchId)
      .maybeSingle();

    if (matchError || !match) {
      return new Response(JSON.stringify({ success: false, error: "match_not_found" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (match.profile_id_1 !== actorId && match.profile_id_2 !== actorId) {
      return new Response(JSON.stringify({ success: false, error: "access_denied" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sessionRows = await loadSessionRows(serviceClient, matchId, gameSessionId);
    if (hasSessionComplete(sessionRows)) {
      return new Response(JSON.stringify({ success: false, error: "session_already_complete" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expectedIndex = maxEventIndex(sessionRows) + 1;
    if (eventIndex !== expectedIndex) {
      return new Response(
        JSON.stringify({ success: false, error: "event_index_out_of_order", expected: expectedIndex }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (eventType === "session_start") {
      if (eventIndex !== 0) {
        return new Response(JSON.stringify({ success: false, error: "session_start_must_be_index_0" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (sessionRows.length > 0) {
        return new Response(JSON.stringify({ success: false, error: "session_already_started" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      const starter = sessionStarterId(sessionRows);
      if (!starter) {
        return new Response(JSON.stringify({ success: false, error: "missing_session_start" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!PARTNER_EVENTS.has(eventType)) {
        return new Response(JSON.stringify({ success: false, error: "invalid_event_after_start" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (actorId === starter) {
        return new Response(JSON.stringify({ success: false, error: "partner_event_required" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const messageId = crypto.randomUUID();
    const emittedAt = new Date().toISOString();

    const envelope: Record<string, unknown> = {
      schema: SCHEMA,
      version: VERSION,
      game_session_id: gameSessionId,
      event_id: messageId,
      event_index: eventIndex,
      event_type: eventType,
      game_type: gameType,
      actor_id: actorId,
      emitted_at: emittedAt,
      payload: validated.payload,
    };
    if (clientRequestId && isUuid(clientRequestId)) {
      envelope.client_request_id = clientRequestId;
    }

    const content = contentLabel(gameType, eventType);

    const insertRow = async (id: string, env: Record<string, unknown>, cont: string) => {
      const { data, error } = await serviceClient
        .from("messages")
        .insert({
          id,
          match_id: matchId,
          sender_id: actorId,
          content: cont,
          message_kind: MESSAGE_KIND,
          structured_payload: env,
        })
        .select("id, match_id, sender_id, content, created_at, message_kind, structured_payload")
        .single();
      return { data, error };
    };

    let { data: inserted, error: insertError } = await insertRow(messageId, envelope, content);

    if (insertError) {
      const code = (insertError as { code?: string }).code;
      if (code === "23505") {
        const allRows = await loadSessionRows(serviceClient, matchId, gameSessionId);
        if (clientRequestId && isUuid(clientRequestId)) {
          const existing = allRows.find(
            (r) =>
              (r.structured_payload as { client_request_id?: string })?.client_request_id ===
              clientRequestId,
          );
          if (existing) {
            return new Response(
              JSON.stringify({ success: true, idempotent: true, message: existing }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }
        const existingByIndex = allRows.find(
          (r) =>
            Number((r.structured_payload as { event_index?: number }).event_index) === eventIndex,
        );
        if (existingByIndex) {
          return new Response(
            JSON.stringify({ success: true, idempotent: true, message: existingByIndex }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
      console.error("send-game-event insert error:", insertError);
      return new Response(JSON.stringify({ success: false, error: "insert_failed" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    sessionRows = await loadSessionRows(serviceClient, matchId, gameSessionId);

    const messagesOut: unknown[] = [inserted];

    const emitComplete = shouldEmitComplete(gameType, eventType, validated.payload, sessionRows);
    if (emitComplete) {
      const completeId = crypto.randomUUID();
      const completeIndex = eventIndex + 1;
      const completeEnv: Record<string, unknown> = {
        schema: SCHEMA,
        version: VERSION,
        game_session_id: gameSessionId,
        event_id: completeId,
        event_index: completeIndex,
        event_type: "session_complete",
        game_type: gameType,
        actor_id: actorId,
        emitted_at: new Date().toISOString(),
        payload: { reason: completeReason(gameType, eventType) },
      };
      const { data: completeRow, error: completeErr } = await insertRow(
        completeId,
        completeEnv,
        contentLabel(gameType, "session_complete"),
      );
      if (!completeErr && completeRow) messagesOut.push(completeRow);
      else if (completeErr) console.error("send-game-event complete insert error:", completeErr);
    }

    const recipientId =
      match.profile_id_1 === actorId ? match.profile_id_2 : match.profile_id_1;

    try {
      const { data: senderProfile } = await serviceClient
        .from("profiles")
        .select("name")
        .eq("id", actorId)
        .maybeSingle();

      await serviceClient.functions.invoke("send-notification", {
        body: {
          user_id: recipientId,
          category: "messages",
          title: senderProfile?.name || "Vibely",
          body: content.length > 80 ? content.slice(0, 80) + "…" : content,
          data: {
            url: `/chat/${actorId}`,
            match_id: matchId,
            sender_id: actorId,
          },
        },
      });
    } catch (notifyErr) {
      console.error("send-game-event notification error:", notifyErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        messages: messagesOut,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-game-event unexpected error:", err);
    return new Response(JSON.stringify({ success: false, error: "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
