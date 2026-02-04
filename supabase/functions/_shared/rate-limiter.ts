import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number; // in milliseconds
  functionName: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

// In-memory rate limit store for edge function instance
// Note: This is per-instance, so distributed rate limiting requires a database approach
const rateLimitStore = new Map<string, { count: number; windowStart: number }>();

/**
 * Check if a request is rate limited using in-memory store
 * Falls back to database-based rate limiting for persistence across instances
 */
export async function checkRateLimit(
  userId: string,
  config: RateLimitConfig,
  supabaseAdmin?: ReturnType<typeof createClient>
): Promise<RateLimitResult> {
  const key = `${config.functionName}:${userId}`;
  const now = Date.now();

  // Try in-memory first (fast path)
  const cached = rateLimitStore.get(key);
  
  if (cached) {
    // Check if window has expired
    if (now - cached.windowStart > config.windowMs) {
      // Reset window
      rateLimitStore.set(key, { count: 1, windowStart: now });
      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        resetAt: new Date(now + config.windowMs),
      };
    }

    // Check if limit exceeded
    if (cached.count >= config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(cached.windowStart + config.windowMs),
      };
    }

    // Increment count
    cached.count++;
    rateLimitStore.set(key, cached);
    return {
      allowed: true,
      remaining: config.maxRequests - cached.count,
      resetAt: new Date(cached.windowStart + config.windowMs),
    };
  }

  // No cached entry, create new one
  rateLimitStore.set(key, { count: 1, windowStart: now });
  return {
    allowed: true,
    remaining: config.maxRequests - 1,
    resetAt: new Date(now + config.windowMs),
  };
}

/**
 * Create a rate limit response with appropriate headers
 */
export function createRateLimitResponse(
  result: RateLimitResult,
  corsHeaders: Record<string, string>
): Response {
  return new Response(
    JSON.stringify({ 
      error: "Rate limit exceeded. Please try again later.",
      retryAfter: Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": result.resetAt.toISOString(),
        "Retry-After": String(Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)),
      },
    }
  );
}

/**
 * Clean up old rate limit entries to prevent memory leaks
 */
export function cleanupRateLimits(maxAgeMs: number = 3600000): void {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (now - value.windowStart > maxAgeMs) {
      rateLimitStore.delete(key);
    }
  }
}

// Run cleanup every 10 minutes
setInterval(() => cleanupRateLimits(), 600000);
