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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_deletion_requests: {
        Row: {
          cancelled_at: string | null
          completed_at: string | null
          id: string
          reason: string | null
          requested_at: string | null
          scheduled_deletion_at: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          completed_at?: string | null
          id?: string
          reason?: string | null
          requested_at?: string | null
          scheduled_deletion_at?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          completed_at?: string | null
          id?: string
          reason?: string | null
          requested_at?: string | null
          scheduled_deletion_at?: string | null
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
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
      age_gate_blocks: {
        Row: {
          blocked_at: string | null
          date_of_birth: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          blocked_at?: string | null
          date_of_birth?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          blocked_at?: string | null
          date_of_birth?: string | null
          id?: string
          user_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "blocked_users_blocked_id_profiles_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocked_users_blocker_id_profiles_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_media_retention_states: {
        Row: {
          account_deletion_pending_at: string | null
          created_at: string
          id: string
          match_id: string
          participant_user_id: string | null
          participant_user_key: string
          retention_state: string
          state_changed_at: string
          updated_at: string
        }
        Insert: {
          account_deletion_pending_at?: string | null
          created_at?: string
          id?: string
          match_id: string
          participant_user_id?: string | null
          participant_user_key: string
          retention_state?: string
          state_changed_at?: string
          updated_at?: string
        }
        Update: {
          account_deletion_pending_at?: string | null
          created_at?: string
          id?: string
          match_id?: string
          participant_user_id?: string | null
          participant_user_key?: string
          retention_state?: string
          state_changed_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      credit_adjustments: {
        Row: {
          adjustment_reason: string | null
          admin_id: string | null
          created_at: string
          credit_type: string
          id: string
          new_value: number
          previous_value: number
          user_id: string
        }
        Insert: {
          adjustment_reason?: string | null
          admin_id?: string | null
          created_at?: string
          credit_type: string
          id?: string
          new_value: number
          previous_value: number
          user_id: string
        }
        Update: {
          adjustment_reason?: string | null
          admin_id?: string | null
          created_at?: string
          credit_type?: string
          id?: string
          new_value?: number
          previous_value?: number
          user_id?: string
        }
        Relationships: []
      }
      daily_drop_cooldowns: {
        Row: {
          cooldown_until: string
          created_at: string | null
          id: string
          reason: string
          user_a_id: string
          user_b_id: string
        }
        Insert: {
          cooldown_until: string
          created_at?: string | null
          id?: string
          reason: string
          user_a_id: string
          user_b_id: string
        }
        Update: {
          cooldown_until?: string
          created_at?: string | null
          id?: string
          reason?: string
          user_a_id?: string
          user_b_id?: string
        }
        Relationships: []
      }
      daily_drops: {
        Row: {
          affinity_score: number | null
          chat_unlocked: boolean | null
          created_at: string | null
          drop_date: string
          expires_at: string
          id: string
          match_id: string | null
          opener_sender_id: string | null
          opener_sent_at: string | null
          opener_text: string | null
          passed_by_user_id: string | null
          pick_reasons: Json | null
          reply_sender_id: string | null
          reply_sent_at: string | null
          reply_text: string | null
          starts_at: string
          status: string
          updated_at: string | null
          user_a_id: string
          user_a_viewed: boolean | null
          user_b_id: string
          user_b_viewed: boolean | null
        }
        Insert: {
          affinity_score?: number | null
          chat_unlocked?: boolean | null
          created_at?: string | null
          drop_date: string
          expires_at: string
          id?: string
          match_id?: string | null
          opener_sender_id?: string | null
          opener_sent_at?: string | null
          opener_text?: string | null
          passed_by_user_id?: string | null
          pick_reasons?: Json | null
          reply_sender_id?: string | null
          reply_sent_at?: string | null
          reply_text?: string | null
          starts_at: string
          status?: string
          updated_at?: string | null
          user_a_id: string
          user_a_viewed?: boolean | null
          user_b_id: string
          user_b_viewed?: boolean | null
        }
        Update: {
          affinity_score?: number | null
          chat_unlocked?: boolean | null
          created_at?: string | null
          drop_date?: string
          expires_at?: string
          id?: string
          match_id?: string | null
          opener_sender_id?: string | null
          opener_sent_at?: string | null
          opener_text?: string | null
          passed_by_user_id?: string | null
          pick_reasons?: Json | null
          reply_sender_id?: string | null
          reply_sent_at?: string | null
          reply_text?: string | null
          starts_at?: string
          status?: string
          updated_at?: string | null
          user_a_id?: string
          user_a_viewed?: boolean | null
          user_b_id?: string
          user_b_viewed?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_drops_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
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
      date_plan_participants: {
        Row: {
          calendar_issued_at: string
          calendar_title: string
          created_at: string
          date_plan_id: string
          id: string
          user_id: string
        }
        Insert: {
          calendar_issued_at?: string
          calendar_title: string
          created_at?: string
          date_plan_id: string
          id?: string
          user_id: string
        }
        Update: {
          calendar_issued_at?: string
          calendar_title?: string
          created_at?: string
          date_plan_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "date_plan_participants_date_plan_id_fkey"
            columns: ["date_plan_id"]
            isOneToOne: false
            referencedRelation: "date_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_plan_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      date_plans: {
        Row: {
          cancelled_at: string | null
          completion_confirmed_at: string | null
          completion_confirmed_by: string | null
          completion_initiated_at: string | null
          completion_initiated_by: string | null
          created_at: string
          date_suggestion_id: string
          date_type_key: string | null
          ends_at: string | null
          id: string
          match_id: string
          reminder_push_30m_sent_at: string | null
          reminder_push_5m_sent_at: string | null
          starts_at: string | null
          status: string
          venue_label: string | null
        }
        Insert: {
          cancelled_at?: string | null
          completion_confirmed_at?: string | null
          completion_confirmed_by?: string | null
          completion_initiated_at?: string | null
          completion_initiated_by?: string | null
          created_at?: string
          date_suggestion_id: string
          date_type_key?: string | null
          ends_at?: string | null
          id?: string
          match_id: string
          reminder_push_30m_sent_at?: string | null
          reminder_push_5m_sent_at?: string | null
          starts_at?: string | null
          status?: string
          venue_label?: string | null
        }
        Update: {
          cancelled_at?: string | null
          completion_confirmed_at?: string | null
          completion_confirmed_by?: string | null
          completion_initiated_at?: string | null
          completion_initiated_by?: string | null
          created_at?: string
          date_suggestion_id?: string
          date_type_key?: string | null
          ends_at?: string | null
          id?: string
          match_id?: string
          reminder_push_30m_sent_at?: string | null
          reminder_push_5m_sent_at?: string | null
          starts_at?: string | null
          status?: string
          venue_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "date_plans_completion_confirmed_by_fkey"
            columns: ["completion_confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_plans_completion_initiated_by_fkey"
            columns: ["completion_initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_plans_date_suggestion_id_fkey"
            columns: ["date_suggestion_id"]
            isOneToOne: true
            referencedRelation: "date_suggestions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_plans_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
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
      date_suggestion_revisions: {
        Row: {
          agreed_field_flags: Json
          created_at: string
          date_suggestion_id: string
          date_type_key: string
          ends_at: string | null
          id: string
          optional_message: string | null
          place_mode_key: string
          proposed_by: string
          revision_number: number
          schedule_share_enabled: boolean
          starts_at: string | null
          time_block: string | null
          time_choice_key: string
          venue_text: string | null
        }
        Insert: {
          agreed_field_flags?: Json
          created_at?: string
          date_suggestion_id: string
          date_type_key: string
          ends_at?: string | null
          id?: string
          optional_message?: string | null
          place_mode_key: string
          proposed_by: string
          revision_number: number
          schedule_share_enabled?: boolean
          starts_at?: string | null
          time_block?: string | null
          time_choice_key: string
          venue_text?: string | null
        }
        Update: {
          agreed_field_flags?: Json
          created_at?: string
          date_suggestion_id?: string
          date_type_key?: string
          ends_at?: string | null
          id?: string
          optional_message?: string | null
          place_mode_key?: string
          proposed_by?: string
          revision_number?: number
          schedule_share_enabled?: boolean
          starts_at?: string | null
          time_block?: string | null
          time_choice_key?: string
          venue_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "date_suggestion_revisions_date_suggestion_id_fkey"
            columns: ["date_suggestion_id"]
            isOneToOne: false
            referencedRelation: "date_suggestions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_suggestion_revisions_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      date_suggestion_transition_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          date_suggestion_id: string | null
          error_code: string | null
          from_status: string | null
          id: string
          payload: Json | null
          success: boolean
          to_status: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          date_suggestion_id?: string | null
          error_code?: string | null
          from_status?: string | null
          id?: string
          payload?: Json | null
          success?: boolean
          to_status?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          date_suggestion_id?: string | null
          error_code?: string | null
          from_status?: string | null
          id?: string
          payload?: Json | null
          success?: boolean
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "date_suggestion_transition_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_suggestion_transition_log_date_suggestion_id_fkey"
            columns: ["date_suggestion_id"]
            isOneToOne: false
            referencedRelation: "date_suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      date_suggestions: {
        Row: {
          created_at: string
          current_revision_id: string | null
          date_plan_id: string | null
          draft_payload: Json | null
          expires_at: string | null
          expiring_soon_sent_at: string | null
          id: string
          match_id: string
          proposer_id: string
          recipient_id: string
          schedule_share_expires_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_revision_id?: string | null
          date_plan_id?: string | null
          draft_payload?: Json | null
          expires_at?: string | null
          expiring_soon_sent_at?: string | null
          id?: string
          match_id: string
          proposer_id: string
          recipient_id: string
          schedule_share_expires_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_revision_id?: string | null
          date_plan_id?: string | null
          draft_payload?: Json | null
          expires_at?: string | null
          expiring_soon_sent_at?: string | null
          id?: string
          match_id?: string
          proposer_id?: string
          recipient_id?: string
          schedule_share_expires_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "date_suggestions_current_revision_fkey"
            columns: ["current_revision_id"]
            isOneToOne: false
            referencedRelation: "date_suggestion_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_suggestions_date_plan_fkey"
            columns: ["date_plan_id"]
            isOneToOne: false
            referencedRelation: "date_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_suggestions_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_suggestions_proposer_id_fkey"
            columns: ["proposer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_suggestions_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_media_sessions: {
        Row: {
          caption: string | null
          context: string
          created_at: string
          error_detail: string | null
          expires_at: string
          id: string
          media_type: string
          provider: string
          provider_id: string | null
          provider_meta: Json
          published_at: string | null
          status: string
          storage_path: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          caption?: string | null
          context?: string
          created_at?: string
          error_detail?: string | null
          expires_at?: string
          id?: string
          media_type: string
          provider?: string
          provider_id?: string | null
          provider_meta?: Json
          published_at?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          caption?: string | null
          context?: string
          created_at?: string
          error_detail?: string | null
          expires_at?: string
          id?: string
          media_type?: string
          provider?: string
          provider_id?: string | null
          provider_meta?: Json
          published_at?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      event_payment_exceptions: {
        Row: {
          checkout_session_id: string | null
          created_at: string
          created_by: string | null
          event_id: string
          event_status_snapshot: string | null
          exception_status: string
          exception_type: string
          external_refund_reference: string | null
          id: string
          notes: string | null
          profile_id: string
          refund_handled_externally: boolean
          registration_admission_snapshot: string | null
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          settlement_outcome_snapshot: string | null
          support_ticket_id: string | null
          updated_at: string
        }
        Insert: {
          checkout_session_id?: string | null
          created_at?: string
          created_by?: string | null
          event_id: string
          event_status_snapshot?: string | null
          exception_status?: string
          exception_type: string
          external_refund_reference?: string | null
          id?: string
          notes?: string | null
          profile_id: string
          refund_handled_externally?: boolean
          registration_admission_snapshot?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          settlement_outcome_snapshot?: string | null
          support_ticket_id?: string | null
          updated_at?: string
        }
        Update: {
          checkout_session_id?: string | null
          created_at?: string
          created_by?: string | null
          event_id?: string
          event_status_snapshot?: string | null
          exception_status?: string
          exception_type?: string
          external_refund_reference?: string | null
          id?: string
          notes?: string | null
          profile_id?: string
          refund_handled_externally?: boolean
          registration_admission_snapshot?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          settlement_outcome_snapshot?: string | null
          support_ticket_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_payment_exceptions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_payment_exceptions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_payment_exceptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_payment_exceptions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_payment_exceptions_support_ticket_id_fkey"
            columns: ["support_ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      event_registrations: {
        Row: {
          admission_status: string
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
          last_lobby_foregrounded_at: string | null
          last_matched_at: string | null
          payment_status: string
          profile_id: string
          promoted_at: string | null
          queue_status: string | null
          registered_at: string
          waitlisted_at: string | null
        }
        Insert: {
          admission_status?: string
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
          last_lobby_foregrounded_at?: string | null
          last_matched_at?: string | null
          payment_status?: string
          profile_id: string
          promoted_at?: string | null
          queue_status?: string | null
          registered_at?: string
          waitlisted_at?: string | null
        }
        Update: {
          admission_status?: string
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
          last_lobby_foregrounded_at?: string | null
          last_matched_at?: string | null
          payment_status?: string
          profile_id?: string
          promoted_at?: string | null
          queue_status?: string | null
          registered_at?: string
          waitlisted_at?: string | null
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
      event_reminder_queue: {
        Row: {
          created_at: string
          event_id: string
          event_title: string
          id: string
          profile_id: string
          reminder_type: string
          sent_at: string | null
        }
        Insert: {
          created_at?: string
          event_id: string
          event_title: string
          id?: string
          profile_id: string
          reminder_type: string
          sent_at?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string
          event_title?: string
          id?: string
          profile_id?: string
          reminder_type?: string
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_reminder_queue_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_reminder_queue_profile_id_fkey"
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
          language: string | null
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
          language?: string | null
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
          language?: string | null
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
      feedback: {
        Row: {
          admin_notes: string | null
          category: string
          created_at: string | null
          device_info: Json | null
          id: string
          message: string
          page_url: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          admin_notes?: string | null
          category: string
          created_at?: string | null
          device_info?: Json | null
          id?: string
          message: string
          page_url?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          admin_notes?: string | null
          category?: string
          created_at?: string | null
          device_info?: Json | null
          id?: string
          message?: string
          page_url?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: []
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
      match_notification_mutes: {
        Row: {
          created_at: string | null
          id: string
          match_id: string
          muted_until: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          match_id: string
          muted_until?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          match_id?: string
          muted_until?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_notification_mutes_match_id_fkey"
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
      media_assets: {
        Row: {
          bytes: number | null
          created_at: string
          deleted_at: string | null
          id: string
          last_error: string | null
          legacy_id: string | null
          legacy_table: string | null
          media_family: string
          mime_type: string | null
          owner_user_id: string | null
          provider: string
          provider_object_id: string | null
          provider_path: string | null
          purge_after: string | null
          purged_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          bytes?: number | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_error?: string | null
          legacy_id?: string | null
          legacy_table?: string | null
          media_family: string
          mime_type?: string | null
          owner_user_id?: string | null
          provider: string
          provider_object_id?: string | null
          provider_path?: string | null
          purge_after?: string | null
          purged_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          bytes?: number | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_error?: string | null
          legacy_id?: string | null
          legacy_table?: string | null
          media_family?: string
          mime_type?: string | null
          owner_user_id?: string | null
          provider?: string
          provider_object_id?: string | null
          provider_path?: string | null
          purge_after?: string | null
          purged_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_media_family_fkey"
            columns: ["media_family"]
            isOneToOne: false
            referencedRelation: "media_retention_settings"
            referencedColumns: ["media_family"]
          },
        ]
      }
      media_delete_jobs: {
        Row: {
          asset_id: string
          attempts: number
          completed_at: string | null
          created_at: string
          id: string
          job_type: string
          last_error: string | null
          max_attempts: number
          next_attempt_at: string
          provider: string
          provider_object_id: string | null
          provider_path: string | null
          started_at: string | null
          status: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          asset_id: string
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          job_type?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          provider: string
          provider_object_id?: string | null
          provider_path?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          asset_id?: string
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          job_type?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          provider?: string
          provider_object_id?: string | null
          provider_path?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_delete_jobs_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      media_references: {
        Row: {
          asset_id: string
          created_at: string
          id: string
          is_active: boolean
          ref_id: string
          ref_key: string | null
          ref_table: string
          ref_type: string
          released_at: string | null
          released_by: string | null
          updated_at: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          ref_id: string
          ref_key?: string | null
          ref_table: string
          ref_type: string
          released_at?: string | null
          released_by?: string | null
          updated_at?: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          ref_id?: string
          ref_key?: string | null
          ref_table?: string
          ref_type?: string
          released_at?: string | null
          released_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_references_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      media_retention_settings: {
        Row: {
          batch_size: number
          dry_run: boolean
          eligible_days: number | null
          max_attempts: number
          media_family: string
          notes: string | null
          retention_days: number | null
          retention_mode: string
          updated_at: string
          updated_by: string | null
          worker_enabled: boolean
        }
        Insert: {
          batch_size?: number
          dry_run?: boolean
          eligible_days?: number | null
          max_attempts?: number
          media_family: string
          notes?: string | null
          retention_days?: number | null
          retention_mode?: string
          updated_at?: string
          updated_by?: string | null
          worker_enabled?: boolean
        }
        Update: {
          batch_size?: number
          dry_run?: boolean
          eligible_days?: number | null
          max_attempts?: number
          media_family?: string
          notes?: string | null
          retention_days?: number | null
          retention_mode?: string
          updated_at?: string
          updated_by?: string | null
          worker_enabled?: boolean
        }
        Relationships: []
      }
      message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          match_id: string
          message_id: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          match_id: string
          message_id: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          match_id?: string
          message_id?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_profile_id_fkey"
            columns: ["profile_id"]
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
          message_kind: string
          read_at: string | null
          ref_id: string | null
          sender_id: string
          structured_payload: Json | null
          video_duration_seconds: number | null
          video_url: string | null
        }
        Insert: {
          audio_duration_seconds?: number | null
          audio_url?: string | null
          content: string
          created_at?: string
          id?: string
          match_id: string
          message_kind?: string
          read_at?: string | null
          ref_id?: string | null
          sender_id: string
          structured_payload?: Json | null
          video_duration_seconds?: number | null
          video_url?: string | null
        }
        Update: {
          audio_duration_seconds?: number | null
          audio_url?: string | null
          content?: string
          created_at?: string
          id?: string
          match_id?: string
          message_kind?: string
          read_at?: string | null
          ref_id?: string | null
          sender_id?: string
          structured_payload?: Json | null
          video_duration_seconds?: number | null
          video_url?: string | null
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
            foreignKeyName: "messages_ref_id_fkey"
            columns: ["ref_id"]
            isOneToOne: false
            referencedRelation: "date_suggestions"
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
      notification_log: {
        Row: {
          body: string
          category: string
          created_at: string | null
          data: Json | null
          delivered: boolean | null
          id: string
          suppressed_reason: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          category: string
          created_at?: string | null
          data?: Json | null
          delivered?: boolean | null
          id?: string
          suppressed_reason?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          category?: string
          created_at?: string | null
          data?: Json | null
          delivered?: boolean | null
          id?: string
          suppressed_reason?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string | null
          id: string
          message_bundle_enabled: boolean | null
          mobile_onesignal_player_id: string | null
          mobile_onesignal_subscribed: boolean | null
          notify_credits_subscription: boolean | null
          notify_daily_drop: boolean | null
          notify_date_reminder: boolean | null
          notify_event_live: boolean | null
          notify_event_reminder: boolean | null
          notify_messages: boolean | null
          notify_new_match: boolean | null
          notify_product_updates: boolean | null
          notify_ready_gate: boolean | null
          notify_recommendations: boolean | null
          notify_someone_vibed_you: boolean | null
          onesignal_player_id: string | null
          onesignal_subscribed: boolean | null
          paused_until: string | null
          push_enabled: boolean | null
          quiet_hours_enabled: boolean | null
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          quiet_hours_timezone: string | null
          sound_enabled: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          message_bundle_enabled?: boolean | null
          mobile_onesignal_player_id?: string | null
          mobile_onesignal_subscribed?: boolean | null
          notify_credits_subscription?: boolean | null
          notify_daily_drop?: boolean | null
          notify_date_reminder?: boolean | null
          notify_event_live?: boolean | null
          notify_event_reminder?: boolean | null
          notify_messages?: boolean | null
          notify_new_match?: boolean | null
          notify_product_updates?: boolean | null
          notify_ready_gate?: boolean | null
          notify_recommendations?: boolean | null
          notify_someone_vibed_you?: boolean | null
          onesignal_player_id?: string | null
          onesignal_subscribed?: boolean | null
          paused_until?: string | null
          push_enabled?: boolean | null
          quiet_hours_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          quiet_hours_timezone?: string | null
          sound_enabled?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          message_bundle_enabled?: boolean | null
          mobile_onesignal_player_id?: string | null
          mobile_onesignal_subscribed?: boolean | null
          notify_credits_subscription?: boolean | null
          notify_daily_drop?: boolean | null
          notify_date_reminder?: boolean | null
          notify_event_live?: boolean | null
          notify_event_reminder?: boolean | null
          notify_messages?: boolean | null
          notify_new_match?: boolean | null
          notify_product_updates?: boolean | null
          notify_ready_gate?: boolean | null
          notify_recommendations?: boolean | null
          notify_someone_vibed_you?: boolean | null
          onesignal_player_id?: string | null
          onesignal_subscribed?: boolean | null
          paused_until?: string | null
          push_enabled?: boolean | null
          quiet_hours_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          quiet_hours_timezone?: string | null
          sound_enabled?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      onboarding_drafts: {
        Row: {
          completed_at: string | null
          created_at: string
          current_stage: string
          current_step: number
          expires_at: string
          last_client_platform: string | null
          onboarding_data: Json
          schema_version: number
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_stage?: string
          current_step?: number
          expires_at?: string
          last_client_platform?: string | null
          onboarding_data?: Json
          schema_version?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_stage?: string
          current_step?: number
          expires_at?: string
          last_client_platform?: string | null
          onboarding_data?: Json
          schema_version?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      photo_verifications: {
        Row: {
          client_confidence_score: number | null
          client_match_result: boolean | null
          created_at: string
          expires_at: string
          id: string
          profile_photo_url: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          selfie_url: string
          status: string
          user_id: string
        }
        Insert: {
          client_confidence_score?: number | null
          client_match_result?: boolean | null
          created_at?: string
          expires_at?: string
          id?: string
          profile_photo_url: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          selfie_url: string
          status?: string
          user_id: string
        }
        Update: {
          client_confidence_score?: number | null
          client_match_result?: boolean | null
          created_at?: string
          expires_at?: string
          id?: string
          profile_photo_url?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          selfie_url?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      premium_history: {
        Row: {
          action: string
          admin_id: string | null
          created_at: string | null
          id: string
          premium_until: string | null
          reason: string | null
          user_id: string
        }
        Insert: {
          action: string
          admin_id?: string | null
          created_at?: string | null
          id?: string
          premium_until?: string | null
          reason?: string | null
          user_id: string
        }
        Update: {
          action?: string
          admin_id?: string | null
          created_at?: string | null
          id?: string
          premium_until?: string | null
          reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "premium_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_vibe_videos: {
        Row: {
          asset_id: string
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          is_primary: boolean
          removed_at: string | null
          updated_at: string
          user_id: string
          video_status: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_primary?: boolean
          removed_at?: string | null
          updated_at?: string
          user_id: string
          video_status?: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_primary?: boolean
          removed_at?: string | null
          updated_at?: string
          user_id?: string
          video_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_vibe_videos_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
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
          account_paused: boolean
          account_paused_until: string | null
          activity_status_visibility: string | null
          age: number
          avatar_url: string | null
          bio: string | null
          birth_date: string | null
          bunny_video_status: string
          bunny_video_uid: string | null
          community_agreed_at: string | null
          company: string | null
          country: string | null
          created_at: string
          discoverable: boolean
          discovery_audience: string | null
          discovery_mode: string | null
          discovery_snooze_until: string | null
          distance_visibility: string | null
          email_unsubscribed: boolean
          email_verified: boolean | null
          event_attendance_visibility: string | null
          event_discovery_prefs: Json | null
          events_attended: number | null
          gender: string
          height_cm: number | null
          id: string
          interested_in: string[] | null
          is_paused: boolean
          is_premium: boolean
          is_suspended: boolean | null
          job: string | null
          last_seen_at: string | null
          lifestyle: Json | null
          location: string | null
          location_data: Json | null
          looking_for: string | null
          name: string
          onboarding_complete: boolean
          onboarding_stage: string
          pause_reason: string | null
          paused_at: string | null
          paused_until: string | null
          phone_number: string | null
          phone_verified: boolean
          phone_verified_at: string | null
          photo_verification_expires_at: string | null
          photo_verified: boolean | null
          photo_verified_at: string | null
          photos: string[] | null
          preferred_age_max: number | null
          preferred_age_min: number | null
          premium_granted_at: string | null
          premium_granted_by: string | null
          premium_until: string | null
          prompts: Json | null
          proof_selfie_url: string | null
          referred_by: string | null
          relationship_intent: string | null
          show_distance: boolean
          show_online_status: boolean
          subscription_tier: string
          suspension_reason: string | null
          tagline: string | null
          total_conversations: number | null
          total_matches: number | null
          updated_at: string
          verified_email: string | null
          vibe_caption: string | null
          vibe_score: number
          vibe_score_label: string
          vibe_video_status: string | null
        }
        Insert: {
          about_me?: string | null
          account_paused?: boolean
          account_paused_until?: string | null
          activity_status_visibility?: string | null
          age: number
          avatar_url?: string | null
          bio?: string | null
          birth_date?: string | null
          bunny_video_status?: string
          bunny_video_uid?: string | null
          community_agreed_at?: string | null
          company?: string | null
          country?: string | null
          created_at?: string
          discoverable?: boolean
          discovery_audience?: string | null
          discovery_mode?: string | null
          discovery_snooze_until?: string | null
          distance_visibility?: string | null
          email_unsubscribed?: boolean
          email_verified?: boolean | null
          event_attendance_visibility?: string | null
          event_discovery_prefs?: Json | null
          events_attended?: number | null
          gender: string
          height_cm?: number | null
          id: string
          interested_in?: string[] | null
          is_paused?: boolean
          is_premium?: boolean
          is_suspended?: boolean | null
          job?: string | null
          last_seen_at?: string | null
          lifestyle?: Json | null
          location?: string | null
          location_data?: Json | null
          looking_for?: string | null
          name: string
          onboarding_complete?: boolean
          onboarding_stage?: string
          pause_reason?: string | null
          paused_at?: string | null
          paused_until?: string | null
          phone_number?: string | null
          phone_verified?: boolean
          phone_verified_at?: string | null
          photo_verification_expires_at?: string | null
          photo_verified?: boolean | null
          photo_verified_at?: string | null
          photos?: string[] | null
          preferred_age_max?: number | null
          preferred_age_min?: number | null
          premium_granted_at?: string | null
          premium_granted_by?: string | null
          premium_until?: string | null
          prompts?: Json | null
          proof_selfie_url?: string | null
          referred_by?: string | null
          relationship_intent?: string | null
          show_distance?: boolean
          show_online_status?: boolean
          subscription_tier?: string
          suspension_reason?: string | null
          tagline?: string | null
          total_conversations?: number | null
          total_matches?: number | null
          updated_at?: string
          verified_email?: string | null
          vibe_caption?: string | null
          vibe_score?: number
          vibe_score_label?: string
          vibe_video_status?: string | null
        }
        Update: {
          about_me?: string | null
          account_paused?: boolean
          account_paused_until?: string | null
          activity_status_visibility?: string | null
          age?: number
          avatar_url?: string | null
          bio?: string | null
          birth_date?: string | null
          bunny_video_status?: string
          bunny_video_uid?: string | null
          community_agreed_at?: string | null
          company?: string | null
          country?: string | null
          created_at?: string
          discoverable?: boolean
          discovery_audience?: string | null
          discovery_mode?: string | null
          discovery_snooze_until?: string | null
          distance_visibility?: string | null
          email_unsubscribed?: boolean
          email_verified?: boolean | null
          event_attendance_visibility?: string | null
          event_discovery_prefs?: Json | null
          events_attended?: number | null
          gender?: string
          height_cm?: number | null
          id?: string
          interested_in?: string[] | null
          is_paused?: boolean
          is_premium?: boolean
          is_suspended?: boolean | null
          job?: string | null
          last_seen_at?: string | null
          lifestyle?: Json | null
          location?: string | null
          location_data?: Json | null
          looking_for?: string | null
          name?: string
          onboarding_complete?: boolean
          onboarding_stage?: string
          pause_reason?: string | null
          paused_at?: string | null
          paused_until?: string | null
          phone_number?: string | null
          phone_verified?: boolean
          phone_verified_at?: string | null
          photo_verification_expires_at?: string | null
          photo_verified?: boolean | null
          photo_verified_at?: string | null
          photos?: string[] | null
          preferred_age_max?: number | null
          preferred_age_min?: number | null
          premium_granted_at?: string | null
          premium_granted_by?: string | null
          premium_until?: string | null
          prompts?: Json | null
          proof_selfie_url?: string | null
          referred_by?: string | null
          relationship_intent?: string | null
          show_distance?: boolean
          show_online_status?: boolean
          subscription_tier?: string
          suspension_reason?: string | null
          tagline?: string | null
          total_conversations?: number | null
          total_matches?: number | null
          updated_at?: string
          verified_email?: string | null
          vibe_caption?: string | null
          vibe_score?: number
          vibe_score_label?: string
          vibe_video_status?: string | null
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
      schedule_share_grants: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          match_id: string
          source_date_suggestion_id: string
          source_revision_id: string | null
          subject_user_id: string
          viewer_user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          match_id: string
          source_date_suggestion_id: string
          source_revision_id?: string | null
          subject_user_id: string
          viewer_user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          match_id?: string
          source_date_suggestion_id?: string
          source_revision_id?: string | null
          subject_user_id?: string
          viewer_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_share_grants_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_share_grants_source_date_suggestion_id_fkey"
            columns: ["source_date_suggestion_id"]
            isOneToOne: false
            referencedRelation: "date_suggestions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_share_grants_source_revision_id_fkey"
            columns: ["source_revision_id"]
            isOneToOne: false
            referencedRelation: "date_suggestion_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_share_grants_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_share_grants_viewer_user_id_fkey"
            columns: ["viewer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_credit_checkout_grants: {
        Row: {
          checkout_session_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          checkout_session_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          checkout_session_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_credit_checkout_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_event_ticket_settlements: {
        Row: {
          checkout_session_id: string
          created_at: string
          event_id: string
          outcome: string
          profile_id: string
          result: Json
        }
        Insert: {
          checkout_session_id: string
          created_at?: string
          event_id: string
          outcome: string
          profile_id: string
          result?: Json
        }
        Update: {
          checkout_session_id?: string
          created_at?: string
          event_id?: string
          outcome?: string
          profile_id?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "stripe_event_ticket_settlements_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_event_ticket_settlements_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string | null
          current_period_end: string | null
          id: string
          plan: string | null
          provider: string
          rc_original_app_user_id: string | null
          rc_product_id: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          current_period_end?: string | null
          id?: string
          plan?: string | null
          provider?: string
          rc_original_app_user_id?: string | null
          rc_product_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          current_period_end?: string | null
          id?: string
          plan?: string | null
          provider?: string
          rc_original_app_user_id?: string | null
          rc_product_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      support_ticket_attachments: {
        Row: {
          created_at: string
          file_name: string | null
          file_size: number | null
          file_url: string
          id: string
          ticket_id: string
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          file_size?: number | null
          file_url: string
          id?: string
          ticket_id: string
        }
        Update: {
          created_at?: string
          file_name?: string | null
          file_size?: number | null
          file_url?: string
          id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_attachments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_replies: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          sender_id: string | null
          sender_type: string
          ticket_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          sender_id?: string | null
          sender_type: string
          ticket_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          sender_id?: string | null
          sender_type?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_replies_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          admin_notes: string | null
          app_version: string | null
          assigned_to: string | null
          checkout_session_id: string | null
          created_at: string
          device_model: string | null
          event_id: string | null
          event_payment_exception_id: string | null
          id: string
          message: string
          os_version: string | null
          platform: string | null
          primary_type: string
          priority: string
          reference_id: string
          resolved_at: string | null
          status: string
          subcategory: string
          subject: string | null
          updated_at: string
          user_email: string | null
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          app_version?: string | null
          assigned_to?: string | null
          checkout_session_id?: string | null
          created_at?: string
          device_model?: string | null
          event_id?: string | null
          event_payment_exception_id?: string | null
          id?: string
          message: string
          os_version?: string | null
          platform?: string | null
          primary_type: string
          priority?: string
          reference_id: string
          resolved_at?: string | null
          status?: string
          subcategory: string
          subject?: string | null
          updated_at?: string
          user_email?: string | null
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          app_version?: string | null
          assigned_to?: string | null
          checkout_session_id?: string | null
          created_at?: string
          device_model?: string | null
          event_id?: string | null
          event_payment_exception_id?: string | null
          id?: string
          message?: string
          os_version?: string | null
          platform?: string | null
          primary_type?: string
          priority?: string
          reference_id?: string
          resolved_at?: string | null
          status?: string
          subcategory?: string
          subject?: string | null
          updated_at?: string
          user_email?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_event_payment_exception_id_fkey"
            columns: ["event_payment_exception_id"]
            isOneToOne: false
            referencedRelation: "event_payment_exceptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tier_config_audit: {
        Row: {
          action: string
          admin_id: string | null
          capability_key: string
          created_at: string
          id: string
          new_value: Json | null
          old_value: Json | null
          tier_id: string
        }
        Insert: {
          action: string
          admin_id?: string | null
          capability_key: string
          created_at?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          tier_id: string
        }
        Update: {
          action?: string
          admin_id?: string | null
          capability_key?: string
          created_at?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          tier_id?: string
        }
        Relationships: []
      }
      tier_config_overrides: {
        Row: {
          capability_key: string
          created_at: string
          id: string
          tier_id: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          capability_key: string
          created_at?: string
          id?: string
          tier_id: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          capability_key?: string
          created_at?: string
          id?: string
          tier_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      user_credits: {
        Row: {
          created_at: string
          extended_vibe_credits: number
          extra_time_credits: number
          id: string
          last_replenished_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          extended_vibe_credits?: number
          extra_time_credits?: number
          id?: string
          last_replenished_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          extended_vibe_credits?: number
          extra_time_credits?: number
          id?: string
          last_replenished_at?: string | null
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
        Relationships: [
          {
            foreignKeyName: "user_reports_reported_id_profiles_fkey"
            columns: ["reported_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_reporter_id_profiles_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "user_schedules_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          date_started_at: string | null
          duration_seconds: number | null
          ended_at: string | null
          ended_reason: string | null
          event_id: string
          handshake_started_at: string | null
          id: string
          participant_1_away_at: string | null
          participant_1_id: string
          participant_1_liked: boolean | null
          participant_2_away_at: string | null
          participant_2_id: string
          participant_2_liked: boolean | null
          phase: string
          queued_expires_at: string | null
          ready_gate_expires_at: string | null
          ready_gate_status: string
          ready_participant_1_at: string | null
          ready_participant_2_at: string | null
          reconnect_grace_ends_at: string | null
          snooze_expires_at: string | null
          snoozed_by: string | null
          started_at: string
          state: Database["public"]["Enums"]["video_date_state"]
          state_updated_at: string
          vibe_questions: Json | null
        }
        Insert: {
          daily_room_name?: string | null
          daily_room_url?: string | null
          date_started_at?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          ended_reason?: string | null
          event_id: string
          handshake_started_at?: string | null
          id?: string
          participant_1_away_at?: string | null
          participant_1_id: string
          participant_1_liked?: boolean | null
          participant_2_away_at?: string | null
          participant_2_id: string
          participant_2_liked?: boolean | null
          phase?: string
          queued_expires_at?: string | null
          ready_gate_expires_at?: string | null
          ready_gate_status?: string
          ready_participant_1_at?: string | null
          ready_participant_2_at?: string | null
          reconnect_grace_ends_at?: string | null
          snooze_expires_at?: string | null
          snoozed_by?: string | null
          started_at?: string
          state?: Database["public"]["Enums"]["video_date_state"]
          state_updated_at?: string
          vibe_questions?: Json | null
        }
        Update: {
          daily_room_name?: string | null
          daily_room_url?: string | null
          date_started_at?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          ended_reason?: string | null
          event_id?: string
          handshake_started_at?: string | null
          id?: string
          participant_1_away_at?: string | null
          participant_1_id?: string
          participant_1_liked?: boolean | null
          participant_2_away_at?: string | null
          participant_2_id?: string
          participant_2_liked?: boolean | null
          phase?: string
          queued_expires_at?: string | null
          ready_gate_expires_at?: string | null
          ready_gate_status?: string
          ready_participant_1_at?: string | null
          ready_participant_2_at?: string | null
          reconnect_grace_ends_at?: string | null
          snooze_expires_at?: string | null
          snoozed_by?: string | null
          started_at?: string
          state?: Database["public"]["Enums"]["video_date_state"]
          state_updated_at?: string
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
      waitlist_promotion_notify_queue: {
        Row: {
          created_at: string
          event_id: string
          id: string
          processed_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          processed_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          processed_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_promotion_notify_queue_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_promotion_notify_queue_user_id_fkey"
            columns: ["user_id"]
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
      _date_suggestion_compute_agreed: {
        Args: {
          new_block: string
          new_date_type: string
          new_ends: string
          new_optional: string
          new_place_mode: string
          new_share: boolean
          new_starts: string
          new_time_choice: string
          new_venue: string
          prev_row: Database["public"]["Tables"]["date_suggestion_revisions"]["Row"]
        }
        Returns: Json
      }
      _date_suggestion_core_hash: {
        Args: {
          r: Database["public"]["Tables"]["date_suggestion_revisions"]["Row"]
        }
        Returns: Json
      }
      _date_suggestion_log: {
        Args: {
          p_action: string
          p_actor: string
          p_err: string
          p_from: string
          p_ok: boolean
          p_payload: Json
          p_suggestion_id: string
          p_to: string
        }
        Returns: undefined
      }
      _date_suggestion_partner_first_name: {
        Args: { p_user_id: string }
        Returns: string
      }
      _date_suggestion_upsert_share_grant: {
        Args: {
          p_match_id: string
          p_revision_id: string
          p_subject: string
          p_suggestion_id: string
          p_viewer: string
        }
        Returns: undefined
      }
      activate_profile_vibe_video: {
        Args: { p_user_id: string; p_video_id: string; p_video_status?: string }
        Returns: Json
      }
      admin_cancel_event: { Args: { p_event_id: string }; Returns: Json }
      admin_create_event_payment_exception: {
        Args: {
          p_checkout_session_id?: string
          p_event_id: string
          p_exception_status?: string
          p_exception_type: string
          p_notes?: string
          p_profile_id: string
          p_support_ticket_id?: string
        }
        Returns: Json
      }
      admin_delete_event: { Args: { p_event_id: string }; Returns: Json }
      admin_get_event_confirmed_gender_counts: {
        Args: { p_event_id: string }
        Returns: Json
      }
      admin_remove_event_registration: {
        Args: { p_event_id: string; p_profile_id: string }
        Returns: Json
      }
      admin_transition_event_payment_exception: {
        Args: {
          p_exception_id: string
          p_exception_status?: string
          p_exception_type?: string
          p_external_refund_reference?: string
          p_notes?: string
          p_refund_handled_externally?: boolean
          p_resolution?: string
          p_support_ticket_id?: string
        }
        Returns: Json
      }
      apply_account_deletion_media_hold: {
        Args: { p_user_id: string }
        Returns: Json
      }
      apply_referral_attribution: {
        Args: { p_referrer_id: string }
        Returns: Json
      }
      attach_chat_media_asset_to_match: {
        Args: { p_asset_id: string; p_match_id: string }
        Returns: Json
      }
      backfill_chat_message_media_lifecycle: {
        Args: { p_limit?: number }
        Returns: Json
      }
      calculate_vibe_score: { Args: { p_user_id: string }; Returns: Json }
      calculate_vibe_score_from_row: {
        Args: { p: Database["public"]["Tables"]["profiles"]["Row"] }
        Returns: Json
      }
      can_view_profile_photo: {
        Args: { photo_owner_id: string }
        Returns: boolean
      }
      cancel_account_deletion_media_hold: {
        Args: { p_user_id: string }
        Returns: Json
      }
      cancel_event_registration: { Args: { p_event_id: string }; Returns: Json }
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
      check_premium_status: { Args: { p_user_id: string }; Returns: boolean }
      claim_media_delete_jobs: {
        Args: {
          p_batch_size?: number
          p_family_filter?: string
          p_worker_id: string
        }
        Returns: {
          asset_id: string
          attempts: number
          completed_at: string | null
          created_at: string
          id: string
          job_type: string
          last_error: string | null
          max_attempts: number
          next_attempt_at: string
          provider: string
          provider_object_id: string | null
          provider_path: string | null
          started_at: string | null
          status: string
          updated_at: string
          worker_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "media_delete_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      clear_expired_pauses: { Args: never; Returns: number }
      clear_profile_vibe_video: {
        Args: {
          p_clear_caption?: boolean
          p_released_by?: string
          p_user_id: string
        }
        Returns: Json
      }
      complete_account_deletion_media_cleanup: {
        Args: { p_user_id: string }
        Returns: Json
      }
      complete_media_delete_job: {
        Args: { p_error?: string; p_job_id: string; p_success: boolean }
        Returns: Json
      }
      complete_onboarding: { Args: { p_user_id: string }; Returns: Json }
      create_media_session: {
        Args: {
          p_caption?: string
          p_context?: string
          p_media_type: string
          p_provider_id: string
          p_provider_meta?: Json
          p_storage_path?: string
          p_user_id: string
        }
        Returns: Json
      }
      daily_drop_transition: {
        Args: { p_action: string; p_drop_id: string; p_text?: string }
        Returns: Json
      }
      daily_drops_generation_ran_today: { Args: never; Returns: boolean }
      date_suggestion_apply: {
        Args: { p_action: string; p_payload: Json }
        Returns: Json
      }
      date_suggestion_apply_v2: {
        Args: { p_action: string; p_payload: Json }
        Returns: Json
      }
      deduct_credit: {
        Args: { p_credit_type: string; p_user_id: string }
        Returns: boolean
      }
      delete_chat_for_current_user: {
        Args: { p_match_id: string }
        Returns: Json
      }
      detect_ghost_bootstrap_accounts: {
        Args: { days_old_threshold?: number; min_activity_threshold?: number }
        Returns: {
          account_age_hours: number
          created_at: string
          days_since_creation: number
          email_masked: string
          identity_collision_hints: string[]
          is_bootstrap_fresh: boolean
          last_seen_at: string
          onboarding_complete: boolean
          phone_masked: string
          profile_activity_score: number
          profile_id: string
          review_confidence: string
          total_event_regs: number
          total_matches: number
          total_messages: number
          total_video_sessions: number
        }[]
      }
      drain_match_queue: { Args: { p_event_id: string }; Returns: Json }
      enqueue_media_delete: {
        Args: { p_asset_id: string; p_job_type?: string }
        Returns: Json
      }
      ensure_chat_media_asset: {
        Args: {
          p_legacy_id?: string
          p_legacy_table?: string
          p_media_family: string
          p_owner_user_id: string
          p_provider_path: string
          p_status?: string
        }
        Returns: string
      }
      ensure_chat_media_retention_state: {
        Args: { p_match_id: string; p_user_id: string }
        Returns: string
      }
      ensure_chat_media_retention_states_for_match: {
        Args: { p_match_id: string }
        Returns: {
          participant_user_id: string
          participant_user_key: string
          retention_state: string
          state_id: string
        }[]
      }
      ensure_profile_photo_asset: {
        Args: {
          p_legacy_id?: string
          p_legacy_table?: string
          p_status?: string
          p_storage_path: string
          p_user_id: string
        }
        Returns: string
      }
      ensure_vibe_video_asset: {
        Args: {
          p_legacy_id?: string
          p_legacy_table?: string
          p_status?: string
          p_user_id: string
          p_video_id: string
        }
        Returns: string
      }
      expire_stale_match_calls: { Args: never; Returns: number }
      expire_stale_video_sessions: { Args: never; Returns: number }
      expire_video_date_reconnect_graces: { Args: never; Returns: number }
      extract_chat_image_path_from_content: {
        Args: { p_content: string }
        Returns: string
      }
      finalize_onboarding: {
        Args: { p_final_data?: Json; p_user_id: string }
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
      get_active_media_session: {
        Args: { p_media_type: string; p_user_id: string }
        Returns: Json
      }
      get_daily_drop_candidates: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: {
          about_me: string
          age: number
          avatar_url: string
          bio: string
          bunny_video_status: string
          company: string
          gender: string
          height_cm: number
          id: string
          interested_in: string[]
          job: string
          lifestyle: Json
          location: string
          looking_for: string
          name: string
          phone_verified: boolean
          photo_verified: boolean
          photos: string[]
          prompts: Json
          tagline: string
          vibe_caption: string
          vibe_video_status: string
        }[]
      }
      get_event_attendee_preview: {
        Args: { p_event_id: string; p_viewer_id: string }
        Returns: Json
      }
      get_event_deck: {
        Args: { p_event_id: string; p_limit?: number; p_user_id: string }
        Returns: {
          about_me: string
          age: number
          avatar_url: string
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
          shared_vibe_count: number
          tagline: string
        }[]
      }
      get_event_visible_attendees: {
        Args: { p_event_id: string; p_viewer_id: string }
        Returns: string[]
      }
      get_onboarding_draft: { Args: { p_user_id: string }; Returns: Json }
      get_other_city_events: {
        Args: { p_user_id: string; p_user_lat?: number; p_user_lng?: number }
        Returns: {
          city: string
          country: string
          event_count: number
          sample_cover: string
        }[]
      }
      get_own_pii: {
        Args: { p_user_id: string }
        Returns: {
          phone_number: string
          phone_verified: boolean
          verified_email: string
        }[]
      }
      get_photo_sessions: { Args: { p_user_id: string }; Returns: Json }
      get_shared_schedule_for_date_planning: {
        Args: { p_match_id: string; p_subject_user_id: string }
        Returns: Json
      }
      get_user_subscription_status: {
        Args: { p_user_id: string }
        Returns: string
      }
      get_user_tier: { Args: { p_user_id: string }; Returns: string }
      get_visible_events: {
        Args: {
          p_browse_lat?: number
          p_browse_lng?: number
          p_filter_radius_km?: number
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
          language: string
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
      is_profile_discoverable: {
        Args: { p_target_id: string; p_viewer_id?: string }
        Returns: boolean
      }
      is_profile_hidden: { Args: { p_profile_id: string }; Returns: boolean }
      is_registered_for_event: {
        Args: { _event_id: string; _user_id: string }
        Returns: boolean
      }
      join_matching_queue: {
        Args: { p_event_id: string; p_user_id: string }
        Returns: Json
      }
      leave_matching_queue: { Args: { p_event_id: string }; Returns: Json }
      mark_chat_match_participant_deletion_pending: {
        Args: { p_match_id: string; p_pending_at?: string; p_user_id: string }
        Returns: Json
      }
      mark_lobby_foreground: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      mark_match_messages_read: {
        Args: { p_match_id: string }
        Returns: undefined
      }
      mark_media_asset_soft_deleted_if_unreferenced: {
        Args: { p_asset_id: string; p_deleted_at?: string }
        Returns: Json
      }
      mark_photo_deleted: {
        Args: { p_storage_path: string; p_user_id: string }
        Returns: Json
      }
      mark_photo_drafts_deleted: { Args: { p_paths: string[] }; Returns: Json }
      mark_support_reply_read: {
        Args: { p_reply_id: string }
        Returns: undefined
      }
      match_call_transition: {
        Args: { p_action: string; p_call_id: string }
        Returns: Json
      }
      media_compute_purge_after: {
        Args: { p_deleted_at?: string; p_media_family: string }
        Returns: string
      }
      normalize_media_provider_path: {
        Args: { p_value: string }
        Returns: string
      }
      normalize_relationship_intent: {
        Args: { p_intent: string }
        Returns: string
      }
      promote_purgeable_assets: { Args: { p_limit?: number }; Returns: number }
      promote_ready_gate_if_eligible: {
        Args: { p_event_id: string; p_uid: string }
        Returns: Json
      }
      promote_waitlist_for_event: {
        Args: { p_event_id: string }
        Returns: Json
      }
      promote_waitlist_for_event_worker: {
        Args: { p_event_id: string }
        Returns: Json
      }
      publish_media_session: {
        Args: { p_caption?: string; p_session_id: string }
        Returns: Json
      }
      publish_photo_set: {
        Args: { p_context?: string; p_photos: string[]; p_user_id: string }
        Returns: Json
      }
      ready_gate_transition: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      refresh_my_vibe_score: { Args: never; Returns: Json }
      register_for_event: { Args: { p_event_id: string }; Returns: Json }
      release_chat_match_participant: {
        Args: {
          p_match_id: string
          p_release_reason?: string
          p_retention_state: string
          p_user_id: string
        }
        Returns: Json
      }
      release_media_reference: {
        Args: { p_reference_id: string; p_released_by?: string }
        Returns: Json
      }
      replenish_monthly_credits: { Args: never; Returns: Json }
      reset_tier_config_override: {
        Args: { p_capability_key: string; p_tier_id: string }
        Returns: undefined
      }
      resolve_entry_state: { Args: never; Returns: Json }
      restore_chat_match_participant: {
        Args: { p_match_id: string; p_user_id: string }
        Returns: Json
      }
      save_onboarding_draft: {
        Args: {
          p_data: Json
          p_platform?: string
          p_schema_version?: number
          p_stage: string
          p_step: number
          p_user_id: string
        }
        Returns: Json
      }
      send_event_reminders: { Args: never; Returns: undefined }
      set_tier_config_override: {
        Args: { p_capability_key: string; p_tier_id: string; p_value: Json }
        Returns: undefined
      }
      settle_event_ticket_checkout: {
        Args: {
          p_checkout_session_id: string
          p_event_id: string
          p_profile_id: string
        }
        Returns: Json
      }
      submit_post_date_verdict: {
        Args: { p_liked: boolean; p_session_id: string }
        Returns: Json
      }
      sync_chat_message_media: { Args: { p_message_id: string }; Returns: Json }
      sync_profile_photo_media: {
        Args: { p_avatar_path?: string; p_photos: string[]; p_user_id: string }
        Returns: Json
      }
      update_media_session_status: {
        Args: {
          p_error_detail?: string
          p_new_status: string
          p_provider_id: string
        }
        Returns: Json
      }
      update_onboarding_stage: {
        Args: { p_stage: string; p_user_id: string }
        Returns: undefined
      }
      update_participant_status: {
        Args: { p_event_id: string; p_status: string }
        Returns: undefined
      }
      update_profile_location: {
        Args: {
          p_country: string
          p_lat: number
          p_lng: number
          p_location: string
          p_user_id: string
        }
        Returns: Json
      }
      video_date_transition: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      viewer_shares_event_with_profile: {
        Args: { p_other_profile_id: string }
        Returns: boolean
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
      video_date_state:
        | "ready_gate"
        | "handshake"
        | "date"
        | "post_date"
        | "ended"
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
  graphql_public: {
    Enums: {},
  },
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
      video_date_state: [
        "ready_gate",
        "handshake",
        "date",
        "post_date",
        "ended",
      ],
    },
  },
} as const
