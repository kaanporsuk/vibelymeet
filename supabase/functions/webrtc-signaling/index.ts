import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Type definitions for WebRTC (Deno doesn't have these by default)
interface RTCSessionDescription {
  type: string;
  sdp: string;
}

interface RTCIceCandidate {
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
}

// In-memory store for signaling (in production, use Redis or Supabase Realtime)
const rooms = new Map<string, {
  participants: Map<string, { 
    socket: WebSocket;
    userId: string;
  }>;
  offers: Map<string, RTCSessionDescription>;
  answers: Map<string, RTCSessionDescription>;
  iceCandidates: Map<string, RTCIceCandidate[]>;
}>();

interface SignalingMessage {
  type: 'join' | 'offer' | 'answer' | 'ice-candidate' | 'leave';
  roomId: string;
  userId: string;
  targetUserId?: string;
  payload?: any;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { headers } = req;
  const upgradeHeader = headers.get("upgrade") || "";

  // Handle WebSocket upgrade for real-time signaling
  if (upgradeHeader.toLowerCase() === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    
    let currentRoom: string | null = null;
    let currentUserId: string | null = null;

    socket.onopen = () => {
      console.log("WebSocket connection opened");
    };

    socket.onmessage = (event) => {
      try {
        const message: SignalingMessage = JSON.parse(event.data);
        console.log("Received message:", message.type, "from:", message.userId);

        switch (message.type) {
          case 'join':
            handleJoin(socket, message);
            currentRoom = message.roomId;
            currentUserId = message.userId;
            break;
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
      } catch (error) {
        console.error("Error processing message:", error);
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

  // REST API endpoints for HTTP-based signaling
  const url = new URL(req.url);
  const path = url.pathname.split('/').filter(Boolean);

  try {
    if (req.method === 'POST' && path[0] === 'room') {
      // Create or join a room
      const body = await req.json();
      const { roomId, userId } = body;

      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          participants: new Map(),
          offers: new Map(),
          answers: new Map(),
          iceCandidates: new Map(),
        });
      }

      const room = rooms.get(roomId)!;
      const participantCount = room.participants.size;

      return new Response(JSON.stringify({
        success: true,
        roomId,
        participantCount,
        message: participantCount === 0 ? 'Room created' : 'Joined room',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST' && path[0] === 'offer') {
      const body = await req.json();
      const { roomId, userId, offer } = body;

      const room = rooms.get(roomId);
      if (!room) {
        return new Response(JSON.stringify({ error: 'Room not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      room.offers.set(userId, offer);
      console.log(`Offer stored for user ${userId} in room ${roomId}`);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET' && path[0] === 'offer') {
      const roomId = url.searchParams.get('roomId');
      const excludeUserId = url.searchParams.get('excludeUserId');

      const room = rooms.get(roomId || '');
      if (!room) {
        return new Response(JSON.stringify({ error: 'Room not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get offer from another user
      for (const [userId, offer] of room.offers) {
        if (userId !== excludeUserId) {
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
      const body = await req.json();
      const { roomId, userId, targetUserId, answer } = body;

      const room = rooms.get(roomId);
      if (!room) {
        return new Response(JSON.stringify({ error: 'Room not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      room.answers.set(`${userId}->${targetUserId}`, answer);
      console.log(`Answer stored from ${userId} to ${targetUserId}`);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET' && path[0] === 'answer') {
      const roomId = url.searchParams.get('roomId');
      const userId = url.searchParams.get('userId');

      const room = rooms.get(roomId || '');
      if (!room) {
        return new Response(JSON.stringify({ error: 'Room not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Find answer directed to this user
      for (const [key, answer] of room.answers) {
        if (key.endsWith(`->${userId}`)) {
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
      const body = await req.json();
      const { roomId, userId, candidate } = body;

      const room = rooms.get(roomId);
      if (!room) {
        return new Response(JSON.stringify({ error: 'Room not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!room.iceCandidates.has(userId)) {
        room.iceCandidates.set(userId, []);
      }
      room.iceCandidates.get(userId)!.push(candidate);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET' && path[0] === 'ice-candidates') {
      const roomId = url.searchParams.get('roomId');
      const excludeUserId = url.searchParams.get('excludeUserId');

      const room = rooms.get(roomId || '');
      if (!room) {
        return new Response(JSON.stringify({ error: 'Room not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const candidates: RTCIceCandidate[] = [];
      for (const [userId, userCandidates] of room.iceCandidates) {
        if (userId !== excludeUserId) {
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
    console.error("Error:", error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function handleJoin(socket: WebSocket, message: SignalingMessage) {
  const { roomId, userId } = message;

  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      participants: new Map(),
      offers: new Map(),
      answers: new Map(),
      iceCandidates: new Map(),
    });
  }

  const room = rooms.get(roomId)!;
  
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
