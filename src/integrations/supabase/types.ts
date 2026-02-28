export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admin_activity_logs: {
        Row: {
          action_type: string
          admin_id: string
          created_at: string
          details: Json | null
          id: string
          target_id: string | null
          target_type: string
        }
        Insert: {
          action_type: string
          admin_id: string
          created_at?: string
          details?: Json | null
          id?: string
          target_id?: string | null
          target_type: string
        }
        Update: {
          action_type?: string
          admin_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string
        }
        Relationships: []
      }
      admin_notifications: {
        Row: {
          created_at: string | null
          data: Json | null
          id: string
          message: string
          read: boolean | null
          title: string
          type: string
        }
        Insert: {
          created_at?: string | null
          data?: Json | null
          id?: string
          message: string
          read?: boolean | null
          title: string
          type: string
        }
        Update: {
          created_at?: string | null
          data?: Json | null
          id?: string
          message?: string
          read?: boolean | null
          title?: string
          type?: string
        }
        Relationships: []
      }
      blocked_users: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
          reason: string | null
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
          reason?: string | null
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
          reason?: string | null
        }
        Relationships: []
      }
      credit_adjustments: {
        Row: {
          adjustment_reason: string | null
          admin_id: string
          created_at: string
          credit_type: string
          id: string
          new_value: number
          previous_value: number
          user_id: string
        }
        Insert: {
          adjustment_reason?: string | null
          admin_id: string
          created_at?: string
          credit_type: string
          id?: string
          new_value: number
          previous_value: number
          user_id: string
        }
        Update: {
          adjustment_reason?: string | null
          admin_id?: string
          created_at?: string
          credit_type?: string
          id?: string
          new_value?: number
          previous_value?: number
          user_id?: string
        }
        Relationships: []
      }
      daily_drops: {
        Row: {
          candidate_id: string
          created_at: string
          drop_date: string
          dropped_at: string
          expires_at: string
          id: string
          status: string
          user_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          drop_date?: string
          dropped_at?: string
          expires_at?: string
          id?: string
          status?: string
          user_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          drop_date?: string
          dropped_at?: string
          expires_at?: string
          id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_drops_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      date_feedback: {
        Row: {
          conversation_flow: string | null
          created_at: string
          energy: string | null
          honest_representation: string | null
          id: string
          liked: boolean
          photo_accurate: string | null
          session_id: string
          tag_chemistry: boolean | null
          tag_fun: boolean | null
          tag_respectful: boolean | null
          tag_smart: boolean | null
          target_id: string
          user_id: string
        }
        Insert: {
          conversation_flow?: string | null
          created_at?: string
          energy?: string | null
          honest_representation?: string | null
          id?: string
          liked?: boolean
          photo_accurate?: string | null
          session_id: string
          tag_chemistry?: boolean | null
          tag_fun?: boolean | null
          tag_respectful?: boolean | null
          tag_smart?: boolean | null
          target_id: string
          user_id: string
        }
        Update: {
          conversation_flow?: string | null
          created_at?: string
          energy?: string | null
          honest_representation?: string | null
          id?: string
          liked?: boolean
          photo_accurate?: string | null
          session_id?: string
          tag_chemistry?: boolean | null
          tag_fun?: boolean | null
          tag_respectful?: boolean | null
          tag_smart?: boolean | null
          target_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "date_feedback_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "video_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      date_proposals: {
        Row: {
          activity: string
          created_at: string
          id: string
          match_id: string
          proposed_date: string
          proposer_id: string
          recipient_id: string
          responded_at: string | null
          status: string
          time_block: string
        }
        Insert: {
          activity: string
          created_at?: string
          id?: string
          match_id: string
          proposed_date: string
          proposer_id: string
          recipient_id: string
          responded_at?: string | null
          status?: string
          time_block: string
        }
        Update: {
          activity?: string
          created_at?: string
          id?: string
          match_id?: string
          proposed_date?: string
          proposer_id?: string
          recipient_id?: string
          responded_at?: string | null
          status?: string
          time_block?: string
        }
        Relationships: [
          {
            foreignKeyName: "date_proposals_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      email_drip_log: {
        Row: {
          email_key: string
          id: string
          sent_at: string
          user_id: string
        }
        Insert: {
          email_key: string
          id?: string
          sent_at?: string
          user_id: string
        }
        Update: {
          email_key?: string
          id?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_drip_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_verifications: {
        Row: {
          code: string
          created_at: string
          email: string
          expires_at: string
          id: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          code: string
          created_at?: string
          email: string
          expires_at: string
          id?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      event_registrations: {
        Row: {
          attendance_marked: boolean | null
          attendance_marked_at: string | null
          attendance_marked_by: string | null
          attended: boolean | null
          current_partner_id: string | null
          current_room_id: string | null
          dates_completed: number | null
          event_id: string
          id: string
          joined_queue_at: string | null
          last_active_at: string | null
          last_matched_at: string | null
          profile_id: string
          queue_status: string | null
          registered_at: string
        }
        Insert: {
          attendance_marked?: boolean | null
          attendance_marked_at?: string | null
          attendance_marked_by?: string | null
          attended?: boolean | null
          current_partner_id?: string | null
          current_room_id?: string | null
          dates_completed?: number | null
          event_id: string
          id?: string
          joined_queue_at?: string | null
          last_active_at?: string | null
          last_matched_at?: string | null
          profile_id: string
          queue_status?: string | null
          registered_at?: string
        }
        Update: {
          attendance_marked?: boolean | null
          attendance_marked_at?: string | null
          attendance_marked_by?: string | null
          attended?: boolean | null
          current_partner_id?: string | null
          current_room_id?: string | null
          dates_completed?: number | null
          event_id?: string
          id?: string
          joined_queue_at?: string | null
          last_active_at?: string | null
          last_matched_at?: string | null
          profile_id?: string
          queue_status?: string | null
          registered_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_registrations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_registrations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_swipes: {
        Row: {
          actor_id: string
          created_at: string
          event_id: string
          id: string
          swipe_type: string
          target_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          event_id: string
          id?: string
          swipe_type: string
          target_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          event_id?: string
          id?: string
          swipe_type?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_swipes_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_swipes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_swipes_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_vibes: {
        Row: {
          created_at: string
          event_id: string
          id: string
          receiver_id: string
          sender_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          receiver_id: string
          sender_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          receiver_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_vibes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_vibes_receiver_id_fkey"
            columns: ["receiver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_vibes_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          city: string | null
          country: string | null
          cover_image: string
          created_at: string
          current_attendees: number | null
          description: string | null
          duration_minutes: number | null
          ended_at: string | null
          event_date: string
          id: string
          is_free: boolean | null
          is_location_specific: boolean | null
          is_recurring: boolean | null
          latitude: number | null
          location_address: string | null
          location_name: string | null
          longitude: number | null
          max_attendees: number | null
          max_female_attendees: number | null
          max_male_attendees: number | null
          max_nonbinary_attendees: number | null
          occurrence_number: number | null
          parent_event_id: string | null
          price_amount: number | null
          price_currency: string | null
          radius_km: number | null
          recurrence_count: number | null
          recurrence_days: number[] | null
          recurrence_ends_at: string | null
          recurrence_type: string | null
          scope: string | null
          status: string | null
          tags: string[] | null
          title: string
          updated_at: string
          vibes: string[] | null
          visibility: string | null
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          city?: string | null
          country?: string | null
          cover_image: string
          created_at?: string
          current_attendees?: number | null
          description?: string | null
          duration_minutes?: number | null
          ended_at?: string | null
          event_date: string
          id?: string
          is_free?: boolean | null
          is_location_specific?: boolean | null
          is_recurring?: boolean | null
          latitude?: number | null
          location_address?: string | null
          location_name?: string | null
          longitude?: number | null
          max_attendees?: number | null
          max_female_attendees?: number | null
          max_male_attendees?: number | null
          max_nonbinary_attendees?: number | null
          occurrence_number?: number | null
          parent_event_id?: string | null
          price_amount?: number | null
          price_currency?: string | null
          radius_km?: number | null
          recurrence_count?: number | null
          recurrence_days?: number[] | null
          recurrence_ends_at?: string | null
          recurrence_type?: string | null
          scope?: string | null
          status?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string
          vibes?: string[] | null
          visibility?: string | null
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          city?: string | null
          country?: string | null
          cover_image?: string
          created_at?: string
          current_attendees?: number | null
          description?: string | null
          duration_minutes?: number | null
          ended_at?: string | null
          event_date?: string
          id?: string
          is_free?: boolean | null
          is_location_specific?: boolean | null
          is_recurring?: boolean | null
          latitude?: number | null
          location_address?: string | null
          location_name?: string | null
          longitude?: number | null
          max_attendees?: number | null
          max_female_attendees?: number | null
          max_male_attendees?: number | null
          max_nonbinary_attendees?: number | null
          occurrence_number?: number | null
          parent_event_id?: string | null
          price_amount?: number | null
          price_currency?: string | null
          radius_km?: number | null
          recurrence_count?: number | null
          recurrence_days?: number[] | null
          recurrence_ends_at?: string | null
          recurrence_type?: string | null
          scope?: string | null
          status?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string
          vibes?: string[] | null
          visibility?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_parent_event_id_fkey"
            columns: ["parent_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      match_calls: {
        Row: {
          call_type: string
          callee_id: string
          caller_id: string
          created_at: string
          daily_room_name: string
          daily_room_url: string
          duration_seconds: number | null
          ended_at: string | null
          id: string
          match_id: string
          started_at: string | null
          status: string
        }
        Insert: {
          call_type: string
          callee_id: string
          caller_id: string
          created_at?: string
          daily_room_name: string
          daily_room_url: string
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          match_id: string
          started_at?: string | null
          status?: string
        }
        Update: {
          call_type?: string
          callee_id?: string
          caller_id?: string
          created_at?: string
          daily_room_name?: string
          daily_room_url?: string
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          match_id?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_calls_callee_id_fkey"
            columns: ["callee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_calls_caller_id_fkey"
            columns: ["caller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_calls_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      match_mutes: {
        Row: {
          created_at: string
          id: string
          match_id: string
          muted_until: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          match_id: string
          muted_until: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          match_id?: string
          muted_until?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_mutes_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          event_id: string | null
          id: string
          last_message_at: string | null
          matched_at: string
          profile_id_1: string
          profile_id_2: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          event_id?: string | null
          id?: string
          last_message_at?: string | null
          matched_at?: string
          profile_id_1: string
          profile_id_2: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          event_id?: string | null
          id?: string
          last_message_at?: string | null
          matched_at?: string
          profile_id_1?: string
          profile_id_2?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_profile_id_1_fkey"
            columns: ["profile_id_1"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_profile_id_2_fkey"
            columns: ["profile_id_2"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          audio_duration_seconds: number | null
          audio_url: string | null
          content: string
          created_at: string
          id: string
          match_id: string
          read_at: string | null
          sender_id: string
        }
        Insert: {
          audio_duration_seconds?: number | null
          audio_url?: string | null
          content: string
          created_at?: string
          id?: string
          match_id: string
          read_at?: string | null
          sender_id: string
        }
        Update: {
          audio_duration_seconds?: number | null
          audio_url?: string | null
          content?: string
          created_at?: string
          id?: string
          match_id?: string
          read_at?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_vibes: {
        Row: {
          created_at: string
          id: string
          profile_id: string
          vibe_tag_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
          vibe_tag_id: string
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
          vibe_tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_vibes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_vibes_vibe_tag_id_fkey"
            columns: ["vibe_tag_id"]
            isOneToOne: false
            referencedRelation: "vibe_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          about_me: string | null
          age: number
          avatar_url: string | null
          bio: string | null
          birth_date: string | null
          company: string | null
          country: string | null
          created_at: string
          email_unsubscribed: boolean
          email_verified: boolean | null
          events_attended: number | null
          gender: string
          height_cm: number | null
          id: string
          interested_in: string[] | null
          is_suspended: boolean | null
          job: string | null
          last_seen_at: string | null
          lifestyle: Json | null
          location: string | null
          location_data: Json | null
          looking_for: string | null
          name: string
          phone_number: string | null
          phone_verified: boolean
          phone_verified_at: string | null
          photo_verified: boolean | null
          photo_verified_at: string | null
          photos: string[] | null
          prompts: Json | null
          proof_selfie_url: string | null
          referred_by: string | null
          suspension_reason: string | null
          tagline: string | null
          total_conversations: number | null
          total_matches: number | null
          updated_at: string
          verified_email: string | null
          video_intro_url: string | null
        }
        Insert: {
          about_me?: string | null
          age: number
          avatar_url?: string | null
          bio?: string | null
          birth_date?: string | null
          company?: string | null
          country?: string | null
          created_at?: string
          email_unsubscribed?: boolean
          email_verified?: boolean | null
          events_attended?: number | null
          gender: string
          height_cm?: number | null
          id: string
          interested_in?: string[] | null
          is_suspended?: boolean | null
          job?: string | null
          last_seen_at?: string | null
          lifestyle?: Json | null
          location?: string | null
          location_data?: Json | null
          looking_for?: string | null
          name: string
          phone_number?: string | null
          phone_verified?: boolean
          phone_verified_at?: string | null
          photo_verified?: boolean | null
          photo_verified_at?: string | null
          photos?: string[] | null
          prompts?: Json | null
          proof_selfie_url?: string | null
          referred_by?: string | null
          suspension_reason?: string | null
          tagline?: string | null
          total_conversations?: number | null
          total_matches?: number | null
          updated_at?: string
          verified_email?: string | null
          video_intro_url?: string | null
        }
        Update: {
          about_me?: string | null
          age?: number
          avatar_url?: string | null
          bio?: string | null
          birth_date?: string | null
          company?: string | null
          country?: string | null
          created_at?: string
          email_unsubscribed?: boolean
          email_verified?: boolean | null
          events_attended?: number | null
          gender?: string
          height_cm?: number | null
          id?: string
          interested_in?: string[] | null
          is_suspended?: boolean | null
          job?: string | null
          last_seen_at?: string | null
          lifestyle?: Json | null
          location?: string | null
          location_data?: Json | null
          looking_for?: string | null
          name?: string
          phone_number?: string | null
          phone_verified?: boolean
          phone_verified_at?: string | null
          photo_verified?: boolean | null
          photo_verified_at?: string | null
          photos?: string[] | null
          prompts?: Json | null
          proof_selfie_url?: string | null
          referred_by?: string | null
          suspension_reason?: string | null
          tagline?: string | null
          total_conversations?: number | null
          total_matches?: number | null
          updated_at?: string
          verified_email?: string | null
          video_intro_url?: string | null
        }
        Relationships: []
      }
      push_campaigns: {
        Row: {
          body: string
          created_at: string
          created_by: string
          id: string
          scheduled_at: string | null
          sent_at: string | null
          status: string | null
          target_segment: string | null
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by: string
          id?: string
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string | null
          target_segment?: string | null
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string
          id?: string
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string | null
          target_segment?: string | null
          title?: string
        }
        Relationships: []
      }
      push_notification_events: {
        Row: {
          apns_message_id: string | null
          campaign_id: string | null
          clicked_at: string | null
          created_at: string
          delivered_at: string | null
          device_token: string | null
          error_code: string | null
          error_message: string | null
          fcm_message_id: string | null
          id: string
          opened_at: string | null
          platform: Database["public"]["Enums"]["notification_platform"]
          queued_at: string
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
          user_id: string
        }
        Insert: {
          apns_message_id?: string | null
          campaign_id?: string | null
          clicked_at?: string | null
          created_at?: string
          delivered_at?: string | null
          device_token?: string | null
          error_code?: string | null
          error_message?: string | null
          fcm_message_id?: string | null
          id?: string
          opened_at?: string | null
          platform: Database["public"]["Enums"]["notification_platform"]
          queued_at?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          user_id: string
        }
        Update: {
          apns_message_id?: string | null
          campaign_id?: string | null
          clicked_at?: string | null
          created_at?: string
          delivered_at?: string | null
          device_token?: string | null
          error_code?: string | null
          error_message?: string | null
          fcm_message_id?: string | null
          id?: string
          opened_at?: string | null
          platform?: Database["public"]["Enums"]["notification_platform"]
          queued_at?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_notification_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "push_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          messages_count: number | null
          messages_window_start: string | null
          uploads_count: number | null
          uploads_window_start: string | null
          user_id: string
        }
        Insert: {
          messages_count?: number | null
          messages_window_start?: string | null
          uploads_count?: number | null
          uploads_window_start?: string | null
          user_id: string
        }
        Update: {
          messages_count?: number | null
          messages_window_start?: string | null
          uploads_count?: number | null
          uploads_window_start?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_credits: {
        Row: {
          created_at: string
          extended_vibe_credits: number
          extra_time_credits: number
          id: string
          super_vibe_credits: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          extended_vibe_credits?: number
          extra_time_credits?: number
          id?: string
          super_vibe_credits?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          extended_vibe_credits?: number
          extra_time_credits?: number
          id?: string
          super_vibe_credits?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_reports: {
        Row: {
          action_taken: string | null
          also_blocked: boolean | null
          created_at: string
          details: string | null
          id: string
          reason: string
          reported_id: string
          reporter_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          action_taken?: string | null
          also_blocked?: boolean | null
          created_at?: string
          details?: string | null
          id?: string
          reason: string
          reported_id: string
          reporter_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          action_taken?: string | null
          also_blocked?: boolean | null
          created_at?: string
          details?: string | null
          id?: string
          reason?: string
          reported_id?: string
          reporter_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_schedules: {
        Row: {
          created_at: string
          id: string
          slot_date: string
          slot_key: string
          status: string
          time_block: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          slot_date: string
          slot_key: string
          status?: string
          time_block: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          slot_date?: string
          slot_key?: string
          status?: string
          time_block?: string
          user_id?: string
        }
        Relationships: []
      }
      user_suspensions: {
        Row: {
          expires_at: string | null
          id: string
          lifted_at: string | null
          lifted_by: string | null
          reason: string
          status: string | null
          suspended_at: string | null
          suspended_by: string
          user_id: string
        }
        Insert: {
          expires_at?: string | null
          id?: string
          lifted_at?: string | null
          lifted_by?: string | null
          reason: string
          status?: string | null
          suspended_at?: string | null
          suspended_by: string
          user_id: string
        }
        Update: {
          expires_at?: string | null
          id?: string
          lifted_at?: string | null
          lifted_by?: string | null
          reason?: string
          status?: string | null
          suspended_at?: string | null
          suspended_by?: string
          user_id?: string
        }
        Relationships: []
      }
      user_warnings: {
        Row: {
          acknowledged_at: string | null
          created_at: string | null
          id: string
          issued_by: string
          message: string
          reason: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string | null
          id?: string
          issued_by: string
          message: string
          reason: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string | null
          id?: string
          issued_by?: string
          message?: string
          reason?: string
          user_id?: string
        }
        Relationships: []
      }
      verification_attempts: {
        Row: {
          attempt_at: string
          id: string
          ip_address: string | null
          user_id: string
        }
        Insert: {
          attempt_at?: string
          id?: string
          ip_address?: string | null
          user_id: string
        }
        Update: {
          attempt_at?: string
          id?: string
          ip_address?: string | null
          user_id?: string
        }
        Relationships: []
      }
      vibe_tags: {
        Row: {
          category: string | null
          created_at: string
          emoji: string
          id: string
          label: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          emoji: string
          id?: string
          label: string
        }
        Update: {
          category?: string | null
          created_at?: string
          emoji?: string
          id?: string
          label?: string
        }
        Relationships: []
      }
      video_sessions: {
        Row: {
          daily_room_name: string | null
          daily_room_url: string | null
          duration_seconds: number | null
          ended_at: string | null
          event_id: string
          id: string
          participant_1_id: string
          participant_1_liked: boolean | null
          participant_2_id: string
          participant_2_liked: boolean | null
          ready_gate_expires_at: string | null
          ready_gate_status: string
          ready_participant_1_at: string | null
          ready_participant_2_at: string | null
          snooze_expires_at: string | null
          snoozed_by: string | null
          started_at: string
          vibe_questions: Json | null
        }
        Insert: {
          daily_room_name?: string | null
          daily_room_url?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          event_id: string
          id?: string
          participant_1_id: string
          participant_1_liked?: boolean | null
          participant_2_id: string
          participant_2_liked?: boolean | null
          ready_gate_expires_at?: string | null
          ready_gate_status?: string
          ready_participant_1_at?: string | null
          ready_participant_2_at?: string | null
          snooze_expires_at?: string | null
          snoozed_by?: string | null
          started_at?: string
          vibe_questions?: Json | null
        }
        Update: {
          daily_room_name?: string | null
          daily_room_url?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          event_id?: string
          id?: string
          participant_1_id?: string
          participant_1_liked?: boolean | null
          participant_2_id?: string
          participant_2_liked?: boolean | null
          ready_gate_expires_at?: string | null
          ready_gate_status?: string
          ready_participant_1_at?: string | null
          ready_participant_2_at?: string | null
          snooze_expires_at?: string | null
          snoozed_by?: string | null
          started_at?: string
          vibe_questions?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "video_sessions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_sessions_participant_1_id_fkey"
            columns: ["participant_1_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_sessions_participant_2_id_fkey"
            columns: ["participant_2_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      push_notification_events_admin: {
        Row: {
          apns_message_id: string | null
          campaign_id: string | null
          clicked_at: string | null
          created_at: string | null
          delivered_at: string | null
          device_token: string | null
          error_code: string | null
          error_message: string | null
          fcm_message_id: string | null
          id: string | null
          opened_at: string | null
          platform: Database["public"]["Enums"]["notification_platform"] | null
          queued_at: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_status"] | null
          user_id: string | null
        }
        Insert: {
          apns_message_id?: never
          campaign_id?: string | null
          clicked_at?: string | null
          created_at?: string | null
          delivered_at?: string | null
          device_token?: never
          error_code?: string | null
          error_message?: string | null
          fcm_message_id?: never
          id?: string | null
          opened_at?: string | null
          platform?: Database["public"]["Enums"]["notification_platform"] | null
          queued_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"] | null
          user_id?: string | null
        }
        Update: {
          apns_message_id?: never
          campaign_id?: string | null
          clicked_at?: string | null
          created_at?: string | null
          delivered_at?: string | null
          device_token?: never
          error_code?: string | null
          error_message?: string | null
          fcm_message_id?: never
          id?: string | null
          opened_at?: string | null
          platform?: Database["public"]["Enums"]["notification_platform"] | null
          queued_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"] | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_notification_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "push_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_view_profile_photo: {
        Args: { photo_owner_id: string }
        Returns: boolean
      }
      check_gender_compatibility: {
        Args: {
          _target_gender: string
          _target_interested_in: string[]
          _viewer_id: string
        }
        Returns: boolean
      }
      check_mutual_vibe_and_match: {
        Args: { p_session_id: string }
        Returns: Json
      }
      deduct_credit: {
        Args: { p_credit_type: string; p_user_id: string }
        Returns: boolean
      }
      drain_match_queue: {
        Args: { p_event_id: string; p_user_id: string }
        Returns: Json
      }
      find_mystery_match: {
        Args: { p_event_id: string; p_user_id: string }
        Returns: Json
      }
      find_video_date_match: {
        Args: { p_event_id: string; p_user_id: string }
        Returns: Json
      }
      generate_recurring_events: {
        Args: { p_count?: number; p_parent_id: string }
        Returns: number
      }
      get_event_deck: {
        Args: { p_event_id: string; p_limit?: number; p_user_id: string }
        Returns: {
          age: number
          avatar_url: string
          bio: string
          gender: string
          has_met_before: boolean
          has_super_vibed: boolean
          height_cm: number
          is_already_connected: boolean
          job: string
          location: string
          looking_for: string
          name: string
          photos: string[]
          profile_id: string
          queue_status: string
          tagline: string
          video_intro_url: string
        }[]
      }
      get_other_city_events: {
        Args: { p_user_id: string; p_user_lat?: number; p_user_lng?: number }
        Returns: {
          city: string
          country: string
          event_count: number
          sample_cover: string
        }[]
      }
      get_visible_events: {
        Args: {
          p_browse_lat?: number
          p_browse_lng?: number
          p_is_premium?: boolean
          p_user_id: string
          p_user_lat?: number
          p_user_lng?: number
        }
        Returns: {
          city: string
          computed_status: string
          country: string
          cover_image: string
          current_attendees: number
          description: string
          distance_km: number
          duration_minutes: number
          event_date: string
          id: string
          is_recurring: boolean
          is_registered: boolean
          latitude: number
          longitude: number
          max_attendees: number
          occurrence_number: number
          parent_event_id: string
          radius_km: number
          scope: string
          status: string
          tags: string[]
          title: string
        }[]
      }
      handle_swipe: {
        Args: {
          p_actor_id: string
          p_event_id: string
          p_swipe_type: string
          p_target_id: string
        }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      haversine_distance: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      is_blocked: {
        Args: { user1_id: string; user2_id: string }
        Returns: boolean
      }
      is_registered_for_event: {
        Args: { _event_id: string; _user_id: string }
        Returns: boolean
      }
      join_matching_queue: {
        Args: { p_event_id: string; p_user_id: string }
        Returns: Json
      }
      leave_matching_queue: {
        Args: { p_event_id: string; p_user_id: string }
        Returns: Json
      }
      update_participant_status: {
        Args: { p_event_id: string; p_status: string; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      notification_platform: "web" | "ios" | "android" | "pwa"
      notification_status:
        | "queued"
        | "sending"
        | "sent"
        | "delivered"
        | "opened"
        | "clicked"
        | "failed"
        | "bounced"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      notification_platform: ["web", "ios", "android", "pwa"],
      notification_status: [
        "queued",
        "sending",
        "sent",
        "delivered",
        "opened",
        "clicked",
        "failed",
        "bounced",
      ],
    },
  },
} as const
