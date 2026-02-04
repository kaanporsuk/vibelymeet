import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Type definitions for WebRTC
interface RTCSessionDescription {
  type: string;
  sdp: string;
}

interface RTCIceCandidate {
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
}

// In-memory store for signaling with timestamps for cleanup
const rooms = new Map<string, {
  participants: Map<string, { 
    socket: WebSocket;
    userId: string;
  }>;
  offers: Map<string, RTCSessionDescription>;
  answers: Map<string, RTCSessionDescription>;
  iceCandidates: Map<string, RTCIceCandidate[]>;
  createdAt: number; // Timestamp for TTL cleanup
  lastActivity: number; // Last activity timestamp
}>();

// Room configuration
const ROOM_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours max room lifetime
const ROOM_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes idle timeout
const MAX_ROOMS = 500; // Maximum concurrent rooms
const MAX_CANDIDATES_PER_USER = 50; // Limit ICE candidates per user
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Run cleanup every 5 minutes

// Periodic cleanup of stale rooms
setInterval(() => {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [roomId, room] of rooms.entries()) {
    const isExpired = now - room.createdAt > ROOM_TIMEOUT_MS;
    const isIdle = now - room.lastActivity > ROOM_IDLE_TIMEOUT_MS;
    const isEmpty = room.participants.size === 0;
    
    if (isExpired || isIdle || isEmpty) {
      // Close all participant sockets gracefully
      for (const [, participant] of room.participants) {
        try {
          if (participant.socket.readyState === WebSocket.OPEN) {
            participant.socket.close(1000, isExpired ? 'Room expired' : 'Room idle timeout');
          }
        } catch (e) {
          // Ignore close errors
        }
      }
      rooms.delete(roomId);
      cleanedCount++;
      console.log(`Cleaned up room ${roomId} (${isExpired ? 'expired' : isIdle ? 'idle' : 'empty'})`);
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`Cleaned up ${cleanedCount} stale rooms. Active rooms: ${rooms.size}`);
  }
}, CLEANUP_INTERVAL_MS);

// Helper to update room activity timestamp
function updateRoomActivity(roomId: string) {
  const room = rooms.get(roomId);
  if (room) {
    room.lastActivity = Date.now();
  }
}

// Helper to enforce room limits
function enforceRoomLimits() {
  if (rooms.size >= MAX_ROOMS) {
    // Find and remove the oldest inactive room
    let oldestRoomId: string | null = null;
    let oldestActivity = Infinity;
    
    for (const [roomId, room] of rooms.entries()) {
      if (room.participants.size === 0 && room.lastActivity < oldestActivity) {
        oldestActivity = room.lastActivity;
        oldestRoomId = roomId;
      }
    }
    
    if (oldestRoomId) {
      rooms.delete(oldestRoomId);
      console.log(`Evicted oldest empty room ${oldestRoomId} due to room limit`);
    }
  }
}

interface SignalingMessage {
  type: 'join' | 'offer' | 'answer' | 'ice-candidate' | 'leave';
  roomId: string;
  userId: string;
  targetUserId?: string;
  payload?: any;
  token?: string; // JWT token for authentication
}

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Validate UUID format
function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

// Authenticate user from JWT token
async function authenticateUser(token: string): Promise<string | null> {
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      console.log("Authentication failed:", error?.message);
      return null;
    }
    return user.id;
  } catch (error) {
    console.error("Auth error:", error);
    return null;
  }
}

// Extract token from Authorization header
function extractToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }
  return null;
}

// Validate room access - check if user is a participant in the video session
async function validateRoomAccess(userId: string, roomId: string): Promise<boolean> {
  try {
    // Room ID should match a video session ID
    const { data, error } = await supabase
      .from('video_sessions')
      .select('id, participant_1_id, participant_2_id, ended_at')
      .eq('id', roomId)
      .maybeSingle();
    
    if (error) {
      console.log("Room access check error:", error.message);
      return false;
    }
    
    if (!data) {
      console.log("Room access denied - no video_session exists:", roomId);
      // Require video_session to exist before allowing room access
      // This prevents unauthorized users from joining rooms before legitimate sessions are created
      return false;
    }
    
    // Don't allow joining ended sessions
    if (data.ended_at) {
      console.log("Room access denied - session already ended:", roomId);
      return false;
    }
    
    const hasAccess = data.participant_1_id === userId || data.participant_2_id === userId;
    console.log(`Room access check for ${userId} in room ${roomId}: ${hasAccess}`);
    return hasAccess;
  } catch (error) {
    console.error("Room validation error:", error);
    return false;
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { headers } = req;
  const upgradeHeader = headers.get("upgrade") || "";
  const authHeader = headers.get("authorization");

  // Handle WebSocket upgrade for real-time signaling
  if (upgradeHeader.toLowerCase() === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    
    let currentRoom: string | null = null;
    let currentUserId: string | null = null;
    let authenticatedUserId: string | null = null;

    socket.onopen = () => {
      console.log("WebSocket connection opened");
    };

    socket.onmessage = async (event) => {
      try {
        const message: SignalingMessage = JSON.parse(event.data);
        console.log("Received message:", message.type);

        // Validate input - roomId and userId must be valid UUIDs
        if (message.roomId && !isValidUUID(message.roomId)) {
          socket.send(JSON.stringify({ type: 'error', message: 'Invalid room ID format' }));
          return;
        }
        
        if (message.userId && !isValidUUID(message.userId)) {
          socket.send(JSON.stringify({ type: 'error', message: 'Invalid user ID format' }));
          return;
        }

        // Authenticate on first join message
        if (message.type === 'join') {
          if (message.token) {
            authenticatedUserId = await authenticateUser(message.token);
          }
          
          if (!authenticatedUserId) {
            socket.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
            socket.close(4001, 'Unauthorized');
            return;
          }

          // Verify the userId matches the authenticated user
          if (message.userId !== authenticatedUserId) {
            socket.send(JSON.stringify({ type: 'error', message: 'User ID mismatch' }));
            socket.close(4003, 'Forbidden');
            return;
          }

          // Validate room access
          const hasAccess = await validateRoomAccess(authenticatedUserId, message.roomId);
          if (!hasAccess) {
            socket.send(JSON.stringify({ type: 'error', message: 'Access denied to this room' }));
            socket.close(4003, 'Forbidden');
            return;
          }

          handleJoin(socket, message);
          currentRoom = message.roomId;
          currentUserId = authenticatedUserId;
        } else {
          // For non-join messages, verify we're authenticated
          if (!authenticatedUserId || !currentUserId) {
            socket.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
            return;
          }

          // Verify the userId matches the authenticated user
          if (message.userId !== authenticatedUserId) {
            socket.send(JSON.stringify({ type: 'error', message: 'User ID mismatch' }));
            return;
          }

          switch (message.type) {
            case 'offer':
              handleOffer(message);
              break;
            case 'answer':
              handleAnswer(message);
              break;
            case 'ice-candidate':
              handleIceCandidate(message);
              break;
            case 'leave':
              handleLeave(message);
              break;
          }
        }
      } catch (error) {
        console.error("Error processing message:", error);
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    };

    socket.onclose = () => {
      console.log("WebSocket connection closed");
      if (currentRoom && currentUserId) {
        handleLeave({ type: 'leave', roomId: currentRoom, userId: currentUserId });
      }
    };

    socket.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    return response;
  }

  // REST API endpoints - require authentication
  const token = extractToken(authHeader);
  const authenticatedUserId = token ? await authenticateUser(token) : null;

  const url = new URL(req.url);
  const path = url.pathname.split('/').filter(Boolean);

  try {
    if (req.method === 'POST' && path[0] === 'room') {
      // Require authentication
      if (!authenticatedUserId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const body = await req.json();
      const { roomId } = body;

      // Validate roomId format
      if (!roomId || !isValidUUID(roomId)) {
        return new Response(JSON.stringify({ error: 'Invalid room ID format' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Validate room access
      const hasAccess = await validateRoomAccess(authenticatedUserId, roomId);
      if (!hasAccess) {
        return new Response(JSON.stringify({ error: 'Access denied to this room' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!rooms.has(roomId)) {
        enforceRoomLimits();
        const now = Date.now();
        rooms.set(roomId, {
          participants: new Map(),
          offers: new Map(),
          answers: new Map(),
          iceCandidates: new Map(),
          createdAt: now,
          lastActivity: now,
        });
      }
      
      updateRoomActivity(roomId);

      const room = rooms.get(roomId)!;
      const participantCount = room.participants.size;

      return new Response(JSON.stringify({
        success: true,
        roomId,
        userId: authenticatedUserId, // Return the authenticated userId
        participantCount,
        message: participantCount === 0 ? 'Room created' : 'Joined room',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST' && path[0] === 'offer') {
      if (!authenticatedUserId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const body = await req.json();
      const { roomId, offer } = body;

      if (!roomId || !isValidUUID(roomId)) {
        return new Response(JSON.stringify({ error: 'Invalid room ID format' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const hasAccess = await validateRoomAccess(authenticatedUserId, roomId);
      if (!hasAccess) {
        return new Response(JSON.stringify({ error: 'Access denied' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const room = rooms.get(roomId);
      if (!room) {
        return new Response(JSON.stringify({ error: 'Room not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      room.offers.set(authenticatedUserId, offer);
      console.log(`Offer stored for user ${authenticatedUserId} in room ${roomId}`);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET' && path[0] === 'offer') {
      if (!authenticatedUserId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const roomId = url.searchParams.get('roomId');

      if (!roomId || !isValidUUID(roomId)) {
        return new Response(JSON.stringify({ error: 'Invalid room ID format' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const hasAccess = await validateRoomAccess(authenticatedUserId, roomId);
      if (!hasAccess) {
        return new Response(JSON.stringify({ error: 'Access denied' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const room = rooms.get(roomId);
      if (!room) {
        return new Response(JSON.stringify({ error: 'Room not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get offer from another user
      for (const [userId, offer] of room.offers) {
        if (userId !== authenticatedUserId) {
          return new Response(JSON.stringify({ offer, fromUserId: userId }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response(JSON.stringify({ offer: null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST' && path[0] === 'answer') {
      if (!authenticatedUserId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const body = await req.json();
      const { roomId, targetUserId, answer } = body;

      if (!roomId || !isValidUUID(roomId)) {
        return new Response(JSON.stringify({ error: 'Invalid room ID format' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (targetUserId && !isValidUUID(targetUserId)) {
        return new Response(JSON.stringify({ error: 'Invalid target user ID format' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const hasAccess = await validateRoomAccess(authenticatedUserId, roomId);
      if (!hasAccess) {
        return new Response(JSON.stringify({ error: 'Access denied' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const room = rooms.get(roomId);
      if (!room) {
        return new Response(JSON.stringify({ error: 'Room not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      room.answers.set(`${authenticatedUserId}->${targetUserId}`, answer);
      console.log(`Answer stored from ${authenticatedUserId} to ${targetUserId}`);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET' && path[0] === 'answer') {
      if (!authenticatedUserId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const roomId = url.searchParams.get('roomId');

      if (!roomId || !isValidUUID(roomId)) {
        return new Response(JSON.stringify({ error: 'Invalid room ID format' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const hasAccess = await validateRoomAccess(authenticatedUserId, roomId);
      if (!hasAccess) {
        return new Response(JSON.stringify({ error: 'Access denied' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const room = rooms.get(roomId);
      if (!room) {
        return new Response(JSON.stringify({ error: 'Room not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Find answer directed to this user
      for (const [key, answer] of room.answers) {
        if (key.endsWith(`->${authenticatedUserId}`)) {
          const fromUserId = key.split('->')[0];
          return new Response(JSON.stringify({ answer, fromUserId }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response(JSON.stringify({ answer: null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST' && path[0] === 'ice-candidate') {
      if (!authenticatedUserId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const body = await req.json();
      const { roomId, candidate } = body;

      if (!roomId || !isValidUUID(roomId)) {
        return new Response(JSON.stringify({ error: 'Invalid room ID format' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const hasAccess = await validateRoomAccess(authenticatedUserId, roomId);
      if (!hasAccess) {
        return new Response(JSON.stringify({ error: 'Access denied' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const room = rooms.get(roomId);
      if (!room) {
        return new Response(JSON.stringify({ error: 'Room not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!room.iceCandidates.has(authenticatedUserId)) {
        room.iceCandidates.set(authenticatedUserId, []);
      }
      room.iceCandidates.get(authenticatedUserId)!.push(candidate);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET' && path[0] === 'ice-candidates') {
      if (!authenticatedUserId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const roomId = url.searchParams.get('roomId');

      if (!roomId || !isValidUUID(roomId)) {
        return new Response(JSON.stringify({ error: 'Invalid room ID format' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const hasAccess = await validateRoomAccess(authenticatedUserId, roomId);
      if (!hasAccess) {
        return new Response(JSON.stringify({ error: 'Access denied' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const room = rooms.get(roomId);
      if (!room) {
        return new Response(JSON.stringify({ error: 'Room not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const candidates: RTCIceCandidate[] = [];
      for (const [userId, userCandidates] of room.iceCandidates) {
        if (userId !== authenticatedUserId) {
          candidates.push(...userCandidates);
        }
      }

      return new Response(JSON.stringify({ candidates }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error("WebRTC signaling error"); // Sanitized - no detailed error message
    return new Response(JSON.stringify({ error: "An error occurred. Please try again." }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function handleJoin(socket: WebSocket, message: SignalingMessage) {
  const { roomId, userId } = message;

  // Enforce room limits before creating new room
  enforceRoomLimits();

  const now = Date.now();
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      participants: new Map(),
      offers: new Map(),
      answers: new Map(),
      iceCandidates: new Map(),
      createdAt: now,
      lastActivity: now,
    });
  }

  const room = rooms.get(roomId)!;
  updateRoomActivity(roomId);
  
  // Notify existing participants
  room.participants.forEach((participant) => {
    if (participant.socket.readyState === WebSocket.OPEN) {
      participant.socket.send(JSON.stringify({
        type: 'peer-joined',
        userId,
      }));
    }
  });

  // Add new participant
  room.participants.set(userId, { socket, userId });

  // Send list of existing participants to the new user
  const existingParticipants = Array.from(room.participants.keys()).filter(id => id !== userId);
  socket.send(JSON.stringify({
    type: 'room-joined',
    participants: existingParticipants,
  }));

  console.log(`User ${userId} joined room ${roomId}. Total participants: ${room.participants.size}`);
}

function handleOffer(message: SignalingMessage) {
  const { roomId, userId, targetUserId, payload } = message;
  const room = rooms.get(roomId);
  
  if (!room || !targetUserId) return;

  updateRoomActivity(roomId);

  const targetParticipant = room.participants.get(targetUserId);
  if (targetParticipant && targetParticipant.socket.readyState === WebSocket.OPEN) {
    targetParticipant.socket.send(JSON.stringify({
      type: 'offer',
      fromUserId: userId,
      offer: payload,
    }));
  }
}

function handleAnswer(message: SignalingMessage) {
  const { roomId, userId, targetUserId, payload } = message;
  const room = rooms.get(roomId);
  
  if (!room || !targetUserId) return;

  updateRoomActivity(roomId);

  const targetParticipant = room.participants.get(targetUserId);
  if (targetParticipant && targetParticipant.socket.readyState === WebSocket.OPEN) {
    targetParticipant.socket.send(JSON.stringify({
      type: 'answer',
      fromUserId: userId,
      answer: payload,
    }));
  }
}

function handleIceCandidate(message: SignalingMessage) {
  const { roomId, userId, targetUserId, payload } = message;
  const room = rooms.get(roomId);
  
  if (!room || !targetUserId) return;

  updateRoomActivity(roomId);

  // Limit ICE candidates per user to prevent memory abuse
  const existingCandidates = room.iceCandidates.get(userId) || [];
  if (existingCandidates.length >= MAX_CANDIDATES_PER_USER) {
    console.log(`ICE candidate limit reached for user ${userId} in room ${roomId}`);
    return;
  }

  const targetParticipant = room.participants.get(targetUserId);
  if (targetParticipant && targetParticipant.socket.readyState === WebSocket.OPEN) {
    targetParticipant.socket.send(JSON.stringify({
      type: 'ice-candidate',
      fromUserId: userId,
      candidate: payload,
    }));
  }
}

function handleLeave(message: SignalingMessage) {
  const { roomId, userId } = message;
  const room = rooms.get(roomId);
  
  if (!room) return;

  room.participants.delete(userId);
  room.offers.delete(userId);
  room.iceCandidates.delete(userId);

  // Notify remaining participants
  room.participants.forEach((participant) => {
    if (participant.socket.readyState === WebSocket.OPEN) {
      participant.socket.send(JSON.stringify({
        type: 'peer-left',
        userId,
      }));
    }
  });

  // Clean up empty rooms
  if (room.participants.size === 0) {
    rooms.delete(roomId);
    console.log(`Room ${roomId} deleted (empty)`);
  }

  console.log(`User ${userId} left room ${roomId}`);
}
