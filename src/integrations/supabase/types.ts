/**
 * Supabase `public` schema types — generated from the linked project.
 *
 * Regenerate:
 *   ./scripts/regen-supabase-types.sh
 *
 * Project id matches supabase/config.toml (linked).
 */

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
          admin_id: string | null
          created_at: string
          details: Json | null
          id: string
          target_id: string | null
          target_type: string
        }
        Insert: {
          action_type: string
          admin_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          target_id?: string | null
          target_type: string
        }
        Update: {
          action_type?: string
          admin_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string
        }
        Relationships: []
      }
      admin_idempotency_keys: {
        Row: {
          admin_id: string
          created_at: string
          id: string
          idempotency_key: string
          operation: string
          request_hash: string
          response: Json | null
          updated_at: string
        }
        Insert: {
          admin_id: string
          created_at?: string
          id?: string
          idempotency_key: string
          operation: string
          request_hash: string
          response?: Json | null
          updated_at?: string
        }
        Update: {
          admin_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          operation?: string
          request_hash?: string
          response?: Json | null
          updated_at?: string
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
      admin_permissions: {
        Row: {
          area: string
          created_at: string
          description: string
          is_break_glass: boolean
          label: string
          permission: string
        }
        Insert: {
          area: string
          created_at?: string
          description: string
          is_break_glass?: boolean
          label: string
          permission: string
        }
        Update: {
          area?: string
          created_at?: string
          description?: string
          is_break_glass?: boolean
          label?: string
          permission?: string
        }
        Relationships: []
      }
      admin_role_permissions: {
        Row: {
          created_at: string
          permission: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          permission: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          permission?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "admin_role_permissions_permission_fkey"
            columns: ["permission"]
            isOneToOne: false
            referencedRelation: "admin_permissions"
            referencedColumns: ["permission"]
          },
        ]
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
      consent_events: {
        Row: {
          consent_state: string
          consent_type: string
          id: string
          metadata: Json
          recorded_at: string
          source: string
          user_id: string
        }
        Insert: {
          consent_state: string
          consent_type: string
          id?: string
          metadata?: Json
          recorded_at?: string
          source?: string
          user_id: string
        }
        Update: {
          consent_state?: string
          consent_type?: string
          id?: string
          metadata?: Json
          recorded_at?: string
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      daily_drop_generation_runs: {
        Row: {
          admin_id: string | null
          created_at: string
          details: Json
          error: string | null
          force: boolean
          id: string
          pairs_created: number
          reason: string | null
          run_finished_at: string | null
          run_started_at: string
          source: string
          status: string
          unpaired_users: number | null
          users_notified: number
        }
        Insert: {
          admin_id?: string | null
          created_at?: string
          details?: Json
          error?: string | null
          force?: boolean
          id?: string
          pairs_created?: number
          reason?: string | null
          run_finished_at?: string | null
          run_started_at?: string
          source?: string
          status?: string
          unpaired_users?: number | null
          users_notified?: number
        }
        Update: {
          admin_id?: string | null
          created_at?: string
          details?: Json
          error?: string | null
          force?: boolean
          id?: string
          pairs_created?: number
          reason?: string | null
          run_finished_at?: string | null
          run_started_at?: string
          source?: string
          status?: string
          unpaired_users?: number | null
          users_notified?: number
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
      data_export_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string
          error_message: string | null
          expires_at: string
          id: string
          pii_classification: string
          reason: string
          request_id: string | null
          row_count_estimate: number
          scope: Json
          scope_type: string
          status: string
          storage_path: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by: string
          error_message?: string | null
          expires_at?: string
          id?: string
          pii_classification?: string
          reason: string
          request_id?: string | null
          row_count_estimate?: number
          scope?: Json
          scope_type: string
          status?: string
          storage_path?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string
          error_message?: string | null
          expires_at?: string
          id?: string
          pii_classification?: string
          reason?: string
          request_id?: string | null
          row_count_estimate?: number
          scope?: Json
          scope_type?: string
          status?: string
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_export_jobs_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "data_subject_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      data_subject_requests: {
        Row: {
          created_at: string
          fulfilled_at: string | null
          fulfilled_by: string | null
          id: string
          metadata: Json
          reason: string
          request_type: string
          requested_by: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          fulfilled_at?: string | null
          fulfilled_by?: string | null
          id?: string
          metadata?: Json
          reason: string
          request_type: string
          requested_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          fulfilled_at?: string | null
          fulfilled_by?: string | null
          id?: string
          metadata?: Json
          reason?: string
          request_type?: string
          requested_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_subject_requests_user_id_fkey"
            columns: ["user_id"]
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
      date_plan_completion_confirmations: {
        Row: {
          created_at: string
          date_plan_id: string
          id: string
          marked_complete_at: string
          match_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date_plan_id: string
          id?: string
          marked_complete_at?: string
          match_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          date_plan_id?: string
          id?: string
          marked_complete_at?: string
          match_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "date_plan_completion_confirmations_date_plan_id_fkey"
            columns: ["date_plan_id"]
            isOneToOne: false
            referencedRelation: "date_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_plan_completion_confirmations_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_plan_completion_confirmations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      date_plan_feedback: {
        Row: {
          created_at: string
          date_plan_id: string
          did_meet: string
          felt_safe: string
          free_text: string | null
          id: string
          match_id: string
          profile_accurate: string | null
          report_requested: boolean
          reviewer_user_id: string
          subject_user_id: string
          updated_at: string
          would_meet_again: string | null
        }
        Insert: {
          created_at?: string
          date_plan_id: string
          did_meet: string
          felt_safe: string
          free_text?: string | null
          id?: string
          match_id: string
          profile_accurate?: string | null
          report_requested?: boolean
          reviewer_user_id: string
          subject_user_id: string
          updated_at?: string
          would_meet_again?: string | null
        }
        Update: {
          created_at?: string
          date_plan_id?: string
          did_meet?: string
          felt_safe?: string
          free_text?: string | null
          id?: string
          match_id?: string
          profile_accurate?: string | null
          report_requested?: boolean
          reviewer_user_id?: string
          subject_user_id?: string
          updated_at?: string
          would_meet_again?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "date_plan_feedback_date_plan_id_fkey"
            columns: ["date_plan_id"]
            isOneToOne: false
            referencedRelation: "date_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_plan_feedback_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_plan_feedback_reviewer_user_id_fkey"
            columns: ["reviewer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_plan_feedback_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      event_categories: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          emoji: string
          id: string
          key: string
          label: string
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          emoji: string
          id?: string
          key: string
          label: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          emoji?: string
          id?: string
          key?: string
          label?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      event_loop_observability_events: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: Json
          event_id: string | null
          id: string
          latency_ms: number | null
          operation: string
          outcome: string
          reason_code: string | null
          session_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          event_id?: string | null
          id?: string
          latency_ms?: number | null
          operation: string
          outcome: string
          reason_code?: string | null
          session_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          event_id?: string | null
          id?: string
          latency_ms?: number | null
          operation?: string
          outcome?: string
          reason_code?: string | null
          session_id?: string | null
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
          claimed_at: string | null
          created_at: string
          delivered_at: string | null
          delivery_attempts: number
          event_id: string
          event_title: string
          id: string
          last_error_at: string | null
          last_error_reason: string | null
          profile_id: string
          reminder_type: string
          sent_at: string | null
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_attempts?: number
          event_id: string
          event_title: string
          id?: string
          last_error_at?: string | null
          last_error_reason?: string | null
          profile_id: string
          reminder_type: string
          sent_at?: string | null
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_attempts?: number
          event_id?: string
          event_title?: string
          id?: string
          last_error_at?: string | null
          last_error_reason?: string | null
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
          category_keys: string[]
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
          category_keys?: string[]
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
          category_keys?: string[]
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
      experiment_assignments: {
        Row: {
          assigned_at: string
          bucket: number
          context_summary: Json
          experiment_id: string
          id: string
          user_id: string
          variant_id: string
        }
        Insert: {
          assigned_at?: string
          bucket: number
          context_summary?: Json
          experiment_id: string
          id?: string
          user_id: string
          variant_id: string
        }
        Update: {
          assigned_at?: string
          bucket?: number
          context_summary?: Json
          experiment_id?: string
          id?: string
          user_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiment_assignments_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiment_assignments_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "experiment_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      experiment_exposures: {
        Row: {
          context_summary: Json
          experiment_id: string
          exposed_at: string
          id: string
          surface: string
          user_id: string
          variant_id: string
        }
        Insert: {
          context_summary?: Json
          experiment_id: string
          exposed_at?: string
          id?: string
          surface: string
          user_id: string
          variant_id: string
        }
        Update: {
          context_summary?: Json
          experiment_id?: string
          exposed_at?: string
          id?: string
          surface?: string
          user_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiment_exposures_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiment_exposures_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "experiment_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      experiment_variants: {
        Row: {
          created_at: string
          experiment_id: string
          id: string
          label: string
          payload: Json
          variant_key: string
          weight: number
        }
        Insert: {
          created_at?: string
          experiment_id: string
          id?: string
          label: string
          payload?: Json
          variant_key: string
          weight?: number
        }
        Update: {
          created_at?: string
          experiment_id?: string
          id?: string
          label?: string
          payload?: Json
          variant_key?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "experiment_variants_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      experiments: {
        Row: {
          created_at: string
          created_by: string | null
          ends_at: string | null
          experiment_key: string
          hypothesis: string
          id: string
          name: string
          owner: string
          rollout_percentage: number
          safety_metrics: Json
          seed: string
          starts_at: string | null
          status: string
          targeting: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          experiment_key: string
          hypothesis?: string
          id?: string
          name: string
          owner?: string
          rollout_percentage?: number
          safety_metrics?: Json
          seed?: string
          starts_at?: string | null
          status?: string
          targeting?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          experiment_key?: string
          hypothesis?: string
          id?: string
          name?: string
          owner?: string
          rollout_percentage?: number
          safety_metrics?: Json
          seed?: string
          starts_at?: string | null
          status?: string
          targeting?: Json
          updated_at?: string
        }
        Relationships: []
      }
      feature_flags: {
        Row: {
          created_at: string
          description: string
          enabled: boolean
          flag_key: string
          targeting: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          enabled?: boolean
          flag_key: string
          targeting?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          enabled?: boolean
          flag_key?: string
          targeting?: Json
          updated_at?: string
        }
        Relationships: []
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
      growth_attribution_events: {
        Row: {
          context_summary: Json
          created_at: string
          event_type: string
          id: string
          referral_token_hash: string | null
          referrer_id: string | null
          surface: string
          user_id: string | null
        }
        Insert: {
          context_summary?: Json
          created_at?: string
          event_type: string
          id?: string
          referral_token_hash?: string | null
          referrer_id?: string | null
          surface?: string
          user_id?: string | null
        }
        Update: {
          context_summary?: Json
          created_at?: string
          event_type?: string
          id?: string
          referral_token_hash?: string | null
          referrer_id?: string | null
          surface?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "growth_attribution_events_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_attribution_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_attribution_claims: {
        Row: {
          claimed_at: string
          context_summary: Json
          id: string
          referral_token_hash: string | null
          referred_user_id: string
          referrer_id: string | null
          status: string
        }
        Insert: {
          claimed_at?: string
          context_summary?: Json
          id?: string
          referral_token_hash?: string | null
          referred_user_id: string
          referrer_id?: string | null
          status?: string
        }
        Update: {
          claimed_at?: string
          context_summary?: Json
          id?: string
          referral_token_hash?: string | null
          referred_user_id?: string
          referrer_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_attribution_claims_referred_user_id_fkey"
            columns: ["referred_user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_attribution_claims_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_archives: {
        Row: {
          archived_at: string
          created_at: string
          id: string
          match_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string
          created_at?: string
          id?: string
          match_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string
          created_at?: string
          id?: string
          match_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_archives_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_archives_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_calls: {
        Row: {
          call_type: string
          callee_id: string
          callee_joined_at: string | null
          callee_last_seen_at: string | null
          caller_id: string
          caller_joined_at: string | null
          caller_last_seen_at: string | null
          created_at: string
          daily_room_name: string
          daily_room_url: string
          duration_seconds: number | null
          ended_at: string | null
          ended_by_user_id: string | null
          ended_reason: string | null
          id: string
          match_id: string
          provider_deleted_at: string | null
          started_at: string | null
          status: string
        }
        Insert: {
          call_type: string
          callee_id: string
          callee_joined_at?: string | null
          callee_last_seen_at?: string | null
          caller_id: string
          caller_joined_at?: string | null
          caller_last_seen_at?: string | null
          created_at?: string
          daily_room_name: string
          daily_room_url: string
          duration_seconds?: number | null
          ended_at?: string | null
          ended_by_user_id?: string | null
          ended_reason?: string | null
          id?: string
          match_id: string
          provider_deleted_at?: string | null
          started_at?: string | null
          status?: string
        }
        Update: {
          call_type?: string
          callee_id?: string
          callee_joined_at?: string | null
          callee_last_seen_at?: string | null
          caller_id?: string
          caller_joined_at?: string | null
          caller_last_seen_at?: string | null
          created_at?: string
          daily_room_name?: string
          daily_room_url?: string
          duration_seconds?: number | null
          ended_at?: string | null
          ended_by_user_id?: string | null
          ended_reason?: string | null
          id?: string
          match_id?: string
          provider_deleted_at?: string | null
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
      migration_classifications: {
        Row: {
          classification: string
          created_at: string
          destructive_requires_signoff: boolean
          migration_version: string
          risk_notes: string
          title: string
        }
        Insert: {
          classification: string
          created_at?: string
          destructive_requires_signoff?: boolean
          migration_version: string
          risk_notes?: string
          title: string
        }
        Update: {
          classification?: string
          created_at?: string
          destructive_requires_signoff?: boolean
          migration_version?: string
          risk_notes?: string
          title?: string
        }
        Relationships: []
      }
      moderation_appeals: {
        Row: {
          action_type: string
          appeal_text: string | null
          created_at: string
          decision_reason: string | null
          id: string
          report_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          user_id: string
        }
        Insert: {
          action_type: string
          appeal_text?: string | null
          created_at?: string
          decision_reason?: string | null
          id?: string
          report_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id: string
        }
        Update: {
          action_type?: string
          appeal_text?: string | null
          created_at?: string
          decision_reason?: string | null
          id?: string
          report_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderation_appeals_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "user_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_appeals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_policy_categories: {
        Row: {
          active: boolean
          created_at: string
          description: string
          label: string
          policy_key: string
          severity: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          description: string
          label: string
          policy_key: string
          severity?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string
          label?: string
          policy_key?: string
          severity?: number
        }
        Relationships: []
      }
      moderation_recommendations: {
        Row: {
          confidence: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          id: string
          policy_category: string | null
          rationale: Json
          recommended_action: string
          report_id: string | null
          snapshot_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          confidence?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          id?: string
          policy_category?: string | null
          rationale?: Json
          recommended_action?: string
          report_id?: string | null
          snapshot_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          confidence?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          id?: string
          policy_category?: string | null
          rationale?: Json
          recommended_action?: string
          report_id?: string | null
          snapshot_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderation_recommendations_policy_category_fkey"
            columns: ["policy_category"]
            isOneToOne: false
            referencedRelation: "moderation_policy_categories"
            referencedColumns: ["policy_key"]
          },
          {
            foreignKeyName: "moderation_recommendations_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "user_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_recommendations_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "trust_triage_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_recommendations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      native_release_runs: {
        Row: {
          build_number: string | null
          channel: string
          completed_at: string | null
          created_at: string
          evidence: Json
          id: string
          platform: string
          release_version: string
          started_at: string | null
          status: string
        }
        Insert: {
          build_number?: string | null
          channel: string
          completed_at?: string | null
          created_at?: string
          evidence?: Json
          id?: string
          platform: string
          release_version: string
          started_at?: string | null
          status?: string
        }
        Update: {
          build_number?: string | null
          channel?: string
          completed_at?: string | null
          created_at?: string
          evidence?: Json
          id?: string
          platform?: string
          release_version?: string
          started_at?: string | null
          status?: string
        }
        Relationships: []
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
      notification_outbox: {
        Row: {
          attempt_count: number
          body: string | null
          bypass_preferences: boolean
          category: string
          completed_at: string | null
          created_at: string
          data: Json
          event_reminder_queue_id: string | null
          id: string
          idempotency_key: string
          image_url: string | null
          last_error: string | null
          next_attempt_at: string
          onesignal_notification_id: string | null
          outcome: string | null
          source: string
          status: string
          suppressed_reason: string | null
          title: string | null
          updated_at: string
          user_id: string
          waitlist_promotion_queue_id: string | null
        }
        Insert: {
          attempt_count?: number
          body?: string | null
          bypass_preferences?: boolean
          category: string
          completed_at?: string | null
          created_at?: string
          data?: Json
          event_reminder_queue_id?: string | null
          id?: string
          idempotency_key: string
          image_url?: string | null
          last_error?: string | null
          next_attempt_at?: string
          onesignal_notification_id?: string | null
          outcome?: string | null
          source: string
          status?: string
          suppressed_reason?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
          waitlist_promotion_queue_id?: string | null
        }
        Update: {
          attempt_count?: number
          body?: string | null
          bypass_preferences?: boolean
          category?: string
          completed_at?: string | null
          created_at?: string
          data?: Json
          event_reminder_queue_id?: string | null
          id?: string
          idempotency_key?: string
          image_url?: string | null
          last_error?: string | null
          next_attempt_at?: string
          onesignal_notification_id?: string | null
          outcome?: string | null
          source?: string
          status?: string
          suppressed_reason?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
          waitlist_promotion_queue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_event_reminder_queue_id_fkey"
            columns: ["event_reminder_queue_id"]
            isOneToOne: false
            referencedRelation: "event_reminder_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_outbox_waitlist_promotion_queue_id_fkey"
            columns: ["waitlist_promotion_queue_id"]
            isOneToOne: false
            referencedRelation: "waitlist_promotion_notify_queue"
            referencedColumns: ["id"]
          },
        ]
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
          notify_match_calls: boolean
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
          notify_match_calls?: boolean
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
          notify_match_calls?: boolean
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
      payment_observability_events: {
        Row: {
          amount: number | null
          category: string
          checkout_session_id: string | null
          created_at: string
          currency: string | null
          error_code: string | null
          event_type: string | null
          id: string
          metadata_summary: Json
          pack_id: string | null
          paid_event_id: string | null
          plan: string | null
          result: string | null
          status: string
          stripe_customer_id: string | null
          stripe_event_id: string | null
          stripe_subscription_id: string | null
          user_id: string | null
        }
        Insert: {
          amount?: number | null
          category: string
          checkout_session_id?: string | null
          created_at?: string
          currency?: string | null
          error_code?: string | null
          event_type?: string | null
          id?: string
          metadata_summary?: Json
          pack_id?: string | null
          paid_event_id?: string | null
          plan?: string | null
          result?: string | null
          status: string
          stripe_customer_id?: string | null
          stripe_event_id?: string | null
          stripe_subscription_id?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number | null
          category?: string
          checkout_session_id?: string | null
          created_at?: string
          currency?: string | null
          error_code?: string | null
          event_type?: string | null
          id?: string
          metadata_summary?: Json
          pack_id?: string | null
          paid_event_id?: string | null
          plan?: string | null
          result?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_event_id?: string | null
          stripe_subscription_id?: string | null
          user_id?: string | null
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
      post_date_client_submissions: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          id: string
          idempotency_key: string
          liked: boolean | null
          report_payload: Json | null
          result: Json | null
          session_id: string
          updated_at: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          id?: string
          idempotency_key: string
          liked?: boolean | null
          report_payload?: Json | null
          result?: Json | null
          session_id: string
          updated_at?: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          liked?: boolean | null
          report_payload?: Json | null
          result?: Json | null
          session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_date_client_submissions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_date_client_submissions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "video_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      post_date_pending_verdicts: {
        Row: {
          completed_at: string | null
          created_at: string
          event_id: string | null
          first_detected_at: string
          last_seen_at: string
          missing_user_id: string
          reminder_eligible_at: string
          reminder_error: string | null
          reminder_sent_at: string | null
          session_id: string
          stale_at: string | null
          status: string
          submitted_by: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          event_id?: string | null
          first_detected_at?: string
          last_seen_at?: string
          missing_user_id: string
          reminder_eligible_at?: string
          reminder_error?: string | null
          reminder_sent_at?: string | null
          session_id: string
          stale_at?: string | null
          status?: string
          submitted_by: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          event_id?: string | null
          first_detected_at?: string
          last_seen_at?: string
          missing_user_id?: string
          reminder_eligible_at?: string
          reminder_error?: string | null
          reminder_sent_at?: string | null
          session_id?: string
          stale_at?: string | null
          status?: string
          submitted_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_date_pending_verdicts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "video_sessions"
            referencedColumns: ["id"]
          },
        ]
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
      product_metric_definitions: {
        Row: {
          active: boolean
          created_at: string
          definition: string
          domain: string
          label: string
          metric_key: string
          owner: string
          pii_classification: string
          source_surface: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          definition: string
          domain: string
          label: string
          metric_key: string
          owner?: string
          pii_classification?: string
          source_surface: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          definition?: string
          domain?: string
          label?: string
          metric_key?: string
          owner?: string
          pii_classification?: string
          source_surface?: string
          updated_at?: string
        }
        Relationships: []
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
      provider_cost_snapshots: {
        Row: {
          cost_amount: number
          created_at: string
          currency: string
          id: string
          metadata: Json
          provider: string
          source: string
          window_end: string
          window_start: string
        }
        Insert: {
          cost_amount?: number
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json
          provider: string
          source?: string
          window_end: string
          window_start: string
        }
        Update: {
          cost_amount?: number
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json
          provider?: string
          source?: string
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      provider_usage_snapshots: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          metric_key: string
          provider: string
          source: string
          unit: string
          usage_value: number
          window_end: string
          window_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          metric_key: string
          provider: string
          source?: string
          unit: string
          usage_value?: number
          window_end: string
          window_start: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          metric_key?: string
          provider?: string
          source?: string
          unit?: string
          usage_value?: number
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      public_account_deletion_request_log: {
        Row: {
          created_at: string
          email_hash: string
          id: string
          ip_hash: string
        }
        Insert: {
          created_at?: string
          email_hash: string
          id?: string
          ip_hash: string
        }
        Update: {
          created_at?: string
          email_hash?: string
          id?: string
          ip_hash?: string
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
      quality_budget_definitions: {
        Row: {
          active: boolean
          budget_key: string
          comparison: string
          domain: string
          label: string
          target_value: number
          unit: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          budget_key: string
          comparison: string
          domain: string
          label: string
          target_value: number
          unit: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          budget_key?: string
          comparison?: string
          domain?: string
          label?: string
          target_value?: number
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      quality_budget_observations: {
        Row: {
          budget_key: string
          id: string
          metadata: Json
          observed_at: string
          observed_value: number
          release_version: string | null
          source: string
        }
        Insert: {
          budget_key: string
          id?: string
          metadata?: Json
          observed_at?: string
          observed_value: number
          release_version?: string | null
          source?: string
        }
        Update: {
          budget_key?: string
          id?: string
          metadata?: Json
          observed_at?: string
          observed_value?: number
          release_version?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "quality_budget_observations_budget_key_fkey"
            columns: ["budget_key"]
            isOneToOne: false
            referencedRelation: "quality_budget_definitions"
            referencedColumns: ["budget_key"]
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
      rebuild_rehearsal_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          findings: Json
          id: string
          notes: string | null
          operator_id: string | null
          scope: string
          started_at: string | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          findings?: Json
          id?: string
          notes?: string | null
          operator_id?: string | null
          scope: string
          started_at?: string | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          findings?: Json
          id?: string
          notes?: string | null
          operator_id?: string | null
          scope?: string
          started_at?: string | null
          status?: string
        }
        Relationships: []
      }
      referral_quality_snapshots: {
        Row: {
          activated_users: number
          generated_at: string
          id: string
          invite_clicks: number
          matched_users: number
          quality_score: number
          referred_signups: number
          referrer_id: string
          retained_users: number
          safety_events: number
          window_end: string
          window_start: string
        }
        Insert: {
          activated_users?: number
          generated_at?: string
          id?: string
          invite_clicks?: number
          matched_users?: number
          quality_score?: number
          referred_signups?: number
          referrer_id: string
          retained_users?: number
          safety_events?: number
          window_end: string
          window_start: string
        }
        Update: {
          activated_users?: number
          generated_at?: string
          id?: string
          invite_clicks?: number
          matched_users?: number
          quality_score?: number
          referred_signups?: number
          referrer_id?: string
          retained_users?: number
          safety_events?: number
          window_end?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_quality_snapshots_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_policy_registry: {
        Row: {
          active: boolean
          data_domain: string
          enforcement_surface: string
          legal_basis: string
          policy_key: string
          retention_days: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          data_domain: string
          enforcement_surface: string
          legal_basis: string
          policy_key: string
          retention_days?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          data_domain?: string
          enforcement_surface?: string
          legal_basis?: string
          policy_key?: string
          retention_days?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      revenuecat_webhook_events: {
        Row: {
          app_user_id: string | null
          error_code: string | null
          event_type: string | null
          metadata_summary: Json
          processed_at: string | null
          received_at: string
          revenuecat_event_id: string
          status: string
        }
        Insert: {
          app_user_id?: string | null
          error_code?: string | null
          event_type?: string | null
          metadata_summary?: Json
          processed_at?: string | null
          received_at?: string
          revenuecat_event_id: string
          status?: string
        }
        Update: {
          app_user_id?: string | null
          error_code?: string | null
          event_type?: string | null
          metadata_summary?: Json
          processed_at?: string | null
          received_at?: string
          revenuecat_event_id?: string
          status?: string
        }
        Relationships: []
      }
      schedule_share_grant_slots: {
        Row: {
          created_at: string
          grant_id: string
          id: string
          slot_date: string
          time_block: string
        }
        Insert: {
          created_at?: string
          grant_id: string
          id?: string
          slot_date: string
          time_block: string
        }
        Update: {
          created_at?: string
          grant_id?: string
          id?: string
          slot_date?: string
          time_block?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_share_grant_slots_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "schedule_share_grants"
            referencedColumns: ["id"]
          },
        ]
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
      store_metadata_checklists: {
        Row: {
          checklist_key: string
          evidence: Json
          id: string
          platform: string
          status: string
          updated_at: string
        }
        Insert: {
          checklist_key: string
          evidence?: Json
          id?: string
          platform: string
          status?: string
          updated_at?: string
        }
        Update: {
          checklist_key?: string
          evidence?: Json
          id?: string
          platform?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      store_review_events: {
        Row: {
          action_status: string
          category: string | null
          id: string
          metadata: Json
          observed_at: string
          platform: string
          rating: number | null
          release_version: string | null
          sentiment: string | null
        }
        Insert: {
          action_status?: string
          category?: string | null
          id?: string
          metadata?: Json
          observed_at?: string
          platform: string
          rating?: number | null
          release_version?: string | null
          sentiment?: string | null
        }
        Update: {
          action_status?: string
          category?: string | null
          id?: string
          metadata?: Json
          observed_at?: string
          platform?: string
          rating?: number | null
          release_version?: string | null
          sentiment?: string | null
        }
        Relationships: []
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
      stripe_event_ticket_checkout_intents: {
        Row: {
          checkout_session_id: string
          created_at: string
          event_id: string
          expected_amount: number
          expected_currency: string
          metadata: Json
          settled_at: string | null
          status: string
          stripe_event_id: string | null
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          checkout_session_id: string
          created_at?: string
          event_id: string
          expected_amount: number
          expected_currency: string
          metadata?: Json
          settled_at?: string | null
          status?: string
          stripe_event_id?: string | null
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          checkout_session_id?: string
          created_at?: string
          event_id?: string
          expected_amount?: number
          expected_currency?: string
          metadata?: Json
          settled_at?: string | null
          status?: string
          stripe_event_id?: string | null
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stripe_event_ticket_checkout_intents_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
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
      stripe_webhook_events: {
        Row: {
          checkout_session_id: string | null
          error_code: string | null
          event_type: string
          metadata_summary: Json
          pack_id: string | null
          paid_event_id: string | null
          plan: string | null
          processed_at: string | null
          processing_started_at: string | null
          received_at: string
          result: string | null
          status: string
          stripe_customer_id: string | null
          stripe_event_id: string
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          checkout_session_id?: string | null
          error_code?: string | null
          event_type: string
          metadata_summary?: Json
          pack_id?: string | null
          paid_event_id?: string | null
          plan?: string | null
          processed_at?: string | null
          processing_started_at?: string | null
          received_at?: string
          result?: string | null
          status: string
          stripe_customer_id?: string | null
          stripe_event_id: string
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          checkout_session_id?: string | null
          error_code?: string | null
          event_type?: string
          metadata_summary?: Json
          pack_id?: string | null
          paid_event_id?: string | null
          plan?: string | null
          processed_at?: string | null
          processing_started_at?: string | null
          received_at?: string
          result?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_event_id?: string
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
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
      support_internal_notes: {
        Row: {
          author_id: string
          created_at: string
          id: string
          note: string
          ticket_id: string
          visibility: string
        }
        Insert: {
          author_id: string
          created_at?: string
          id?: string
          note: string
          ticket_id: string
          visibility?: string
        }
        Update: {
          author_id?: string
          created_at?: string
          id?: string
          note?: string
          ticket_id?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_internal_notes_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_response_templates: {
        Row: {
          active: boolean
          body: string
          category: string
          created_at: string
          id: string
          pii_classification: string
          template_key: string
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          body: string
          category: string
          created_at?: string
          id?: string
          pii_classification?: string
          template_key: string
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          body?: string
          category?: string
          created_at?: string
          id?: string
          pii_classification?: string
          template_key?: string
          title?: string
          updated_at?: string
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
      support_ticket_events: {
        Row: {
          actor_id: string | null
          created_at: string
          details: Json
          event_type: string
          id: string
          ticket_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          event_type: string
          id?: string
          ticket_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          event_type?: string
          id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_events_ticket_id_fkey"
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
      trust_triage_snapshots: {
        Row: {
          confidence: string
          created_at: string
          generated_at: string
          id: string
          reasons: Json
          risk_score: number
          signals: Json
          user_id: string
        }
        Insert: {
          confidence?: string
          created_at?: string
          generated_at?: string
          id?: string
          reasons?: Json
          risk_score: number
          signals?: Json
          user_id: string
        }
        Update: {
          confidence?: string
          created_at?: string
          generated_at?: string
          id?: string
          reasons?: Json
          risk_score?: number
          signals?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trust_triage_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      user_notifications: {
        Row: {
          action: Json
          actor_id: string | null
          body: string | null
          category: string
          created_at: string
          data: Json
          dedupe_key: string | null
          dismissed_at: string | null
          expires_at: string | null
          group_count: number
          group_key: string | null
          id: string
          image_url: string | null
          opened_at: string | null
          priority: string
          read_at: string | null
          seen_at: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action?: Json
          actor_id?: string | null
          body?: string | null
          category: string
          created_at?: string
          data?: Json
          dedupe_key?: string | null
          dismissed_at?: string | null
          expires_at?: string | null
          group_count?: number
          group_key?: string | null
          id?: string
          image_url?: string | null
          opened_at?: string | null
          priority?: string
          read_at?: string | null
          seen_at?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action?: Json
          actor_id?: string | null
          body?: string | null
          category?: string
          created_at?: string
          data?: Json
          dedupe_key?: string | null
          dismissed_at?: string | null
          expires_at?: string | null
          group_count?: number
          group_key?: string | null
          id?: string
          image_url?: string | null
          opened_at?: string | null
          priority?: string
          read_at?: string | null
          seen_at?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_reports: {
        Row: {
          action_taken: string | null
          also_blocked: boolean | null
          created_at: string
          details: string | null
          id: string
          moderation_recommendation_id: string | null
          policy_category: string | null
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
          moderation_recommendation_id?: string | null
          policy_category?: string | null
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
          moderation_recommendation_id?: string | null
          policy_category?: string | null
          reason?: string
          reported_id?: string
          reporter_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_reports_moderation_recommendation_id_fkey"
            columns: ["moderation_recommendation_id"]
            isOneToOne: false
            referencedRelation: "moderation_recommendations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_policy_category_fkey"
            columns: ["policy_category"]
            isOneToOne: false
            referencedRelation: "moderation_policy_categories"
            referencedColumns: ["policy_key"]
          },
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
          prior_status: string | null
          slot_date: string
          slot_key: string
          source_date_plan_id: string | null
          status: string
          time_block: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          prior_status?: string | null
          slot_date: string
          slot_key: string
          source_date_plan_id?: string | null
          status?: string
          time_block: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          prior_status?: string | null
          slot_date?: string
          slot_key?: string
          source_date_plan_id?: string | null
          status?: string
          time_block?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_schedules_source_date_plan_id_fkey"
            columns: ["source_date_plan_id"]
            isOneToOne: false
            referencedRelation: "date_plans"
            referencedColumns: ["id"]
          },
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
      video_date_credit_extension_spends: {
        Row: {
          added_seconds: number
          created_at: string
          credit_type: string
          date_extra_seconds_after: number
          id: string
          idempotency_key: string
          session_id: string
          user_id: string
        }
        Insert: {
          added_seconds: number
          created_at?: string
          credit_type: string
          date_extra_seconds_after: number
          id?: string
          idempotency_key: string
          session_id: string
          user_id: string
        }
        Update: {
          added_seconds?: number
          created_at?: string
          credit_type?: string
          date_extra_seconds_after?: number
          id?: string
          idempotency_key?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_date_credit_extension_spends_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "video_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_date_credit_extension_spends_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      video_date_surface_claims: {
        Row: {
          claimed_at: string
          client_instance_id: string
          expires_at: string
          profile_id: string
          released_at: string | null
          session_id: string
          surface: string
          updated_at: string
        }
        Insert: {
          claimed_at?: string
          client_instance_id: string
          expires_at: string
          profile_id: string
          released_at?: string | null
          session_id: string
          surface: string
          updated_at?: string
        }
        Update: {
          claimed_at?: string
          client_instance_id?: string
          expires_at?: string
          profile_id?: string
          released_at?: string | null
          session_id?: string
          surface?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_date_surface_claims_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_date_surface_claims_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "video_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      video_sessions: {
        Row: {
          daily_room_expires_at: string | null
          daily_room_name: string | null
          daily_room_provider_verify_reason: string | null
          daily_room_url: string | null
          daily_room_verified_at: string | null
          date_extra_seconds: number
          date_started_at: string | null
          duration_seconds: number | null
          ended_at: string | null
          ended_reason: string | null
          event_id: string
          handshake_grace_expires_at: string | null
          handshake_started_at: string | null
          id: string
          participant_1_away_at: string | null
          participant_1_decided_at: string | null
          participant_1_id: string
          participant_1_joined_at: string | null
          participant_1_liked: boolean | null
          participant_2_away_at: string | null
          participant_2_decided_at: string | null
          participant_2_id: string
          participant_2_joined_at: string | null
          participant_2_liked: boolean | null
          phase: string
          prepare_entry_actor_id: string | null
          prepare_entry_attempt_id: string | null
          prepare_entry_expires_at: string | null
          prepare_entry_started_at: string | null
          queued_expires_at: string | null
          ready_gate_expires_at: string | null
          ready_gate_status: string
          ready_participant_1_at: string | null
          ready_participant_2_at: string | null
          reconnect_grace_ends_at: string | null
          refund_breakdown: Json | null
          refund_granted_at: string | null
          refund_status: string | null
          snooze_expires_at: string | null
          snoozed_by: string | null
          started_at: string
          state: Database["public"]["Enums"]["video_date_state"]
          state_updated_at: string
          vibe_question_anchor_at: string | null
          vibe_question_index: number
          vibe_questions: Json | null
        }
        Insert: {
          daily_room_expires_at?: string | null
          daily_room_name?: string | null
          daily_room_provider_verify_reason?: string | null
          daily_room_url?: string | null
          daily_room_verified_at?: string | null
          date_extra_seconds?: number
          date_started_at?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          ended_reason?: string | null
          event_id: string
          handshake_grace_expires_at?: string | null
          handshake_started_at?: string | null
          id?: string
          participant_1_away_at?: string | null
          participant_1_decided_at?: string | null
          participant_1_id: string
          participant_1_joined_at?: string | null
          participant_1_liked?: boolean | null
          participant_2_away_at?: string | null
          participant_2_decided_at?: string | null
          participant_2_id: string
          participant_2_joined_at?: string | null
          participant_2_liked?: boolean | null
          phase?: string
          prepare_entry_actor_id?: string | null
          prepare_entry_attempt_id?: string | null
          prepare_entry_expires_at?: string | null
          prepare_entry_started_at?: string | null
          queued_expires_at?: string | null
          ready_gate_expires_at?: string | null
          ready_gate_status?: string
          ready_participant_1_at?: string | null
          ready_participant_2_at?: string | null
          reconnect_grace_ends_at?: string | null
          refund_breakdown?: Json | null
          refund_granted_at?: string | null
          refund_status?: string | null
          snooze_expires_at?: string | null
          snoozed_by?: string | null
          started_at?: string
          state?: Database["public"]["Enums"]["video_date_state"]
          state_updated_at?: string
          vibe_question_anchor_at?: string | null
          vibe_question_index?: number
          vibe_questions?: Json | null
        }
        Update: {
          daily_room_expires_at?: string | null
          daily_room_name?: string | null
          daily_room_provider_verify_reason?: string | null
          daily_room_url?: string | null
          daily_room_verified_at?: string | null
          date_extra_seconds?: number
          date_started_at?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          ended_reason?: string | null
          event_id?: string
          handshake_grace_expires_at?: string | null
          handshake_started_at?: string | null
          id?: string
          participant_1_away_at?: string | null
          participant_1_decided_at?: string | null
          participant_1_id?: string
          participant_1_joined_at?: string | null
          participant_1_liked?: boolean | null
          participant_2_away_at?: string | null
          participant_2_decided_at?: string | null
          participant_2_id?: string
          participant_2_joined_at?: string | null
          participant_2_liked?: boolean | null
          phase?: string
          prepare_entry_actor_id?: string | null
          prepare_entry_attempt_id?: string | null
          prepare_entry_expires_at?: string | null
          prepare_entry_started_at?: string | null
          queued_expires_at?: string | null
          ready_gate_expires_at?: string | null
          ready_gate_status?: string
          ready_participant_1_at?: string | null
          ready_participant_2_at?: string | null
          reconnect_grace_ends_at?: string | null
          refund_breakdown?: Json | null
          refund_granted_at?: string | null
          refund_status?: string | null
          snooze_expires_at?: string | null
          snoozed_by?: string | null
          started_at?: string
          state?: Database["public"]["Enums"]["video_date_state"]
          state_updated_at?: string
          vibe_question_anchor_at?: string | null
          vibe_question_index?: number
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
          outbox_enqueued_at: string | null
          processed_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          outbox_enqueued_at?: string | null
          processed_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          outbox_enqueued_at?: string | null
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
      v_event_loop_drain_events: {
        Row: {
          actor_id: string | null
          created_at: string | null
          detail: Json | null
          detail_found: boolean | null
          detail_queued: boolean | null
          event_id: string | null
          id: string | null
          latency_ms: number | null
          outcome: string | null
          reason_code: string | null
          session_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string | null
          detail?: Json | null
          detail_found?: never
          detail_queued?: never
          event_id?: string | null
          id?: string | null
          latency_ms?: number | null
          outcome?: string | null
          reason_code?: string | null
          session_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string | null
          detail?: Json | null
          detail_found?: never
          detail_queued?: never
          event_id?: string | null
          id?: string | null
          latency_ms?: number | null
          outcome?: string | null
          reason_code?: string | null
          session_id?: string | null
        }
        Relationships: []
      }
      v_event_loop_drain_outcomes_hourly: {
        Row: {
          avg_latency_ms: number | null
          bucket_utc: string | null
          n: number | null
          n_found_true: number | null
          n_queued_wait: number | null
          outcome: string | null
          p50_latency_ms: number | null
          p95_latency_ms: number | null
          reason_code: string | null
        }
        Relationships: []
      }
      v_event_loop_expire_activity_hourly: {
        Row: {
          avg_latency_ms: number | null
          bucket_utc: string | null
          invoke_count: number | null
          outcome: string | null
          sum_hygiene_orphans: number | null
          sum_queued_ttl_expired: number | null
          sum_ready_gate_expired: number | null
          sum_snooze_wake: number | null
          sum_total_mutations: number | null
        }
        Relationships: []
      }
      v_event_loop_expire_events: {
        Row: {
          created_at: string | null
          detail: Json | null
          hygiene_orphans: number | null
          id: string | null
          latency_ms: number | null
          outcome: string | null
          queued_ttl_expired: number | null
          ready_gate_expired: number | null
          reason_code: string | null
          snooze_wake: number | null
          total_mutations: number | null
        }
        Insert: {
          created_at?: string | null
          detail?: Json | null
          hygiene_orphans?: never
          id?: string | null
          latency_ms?: number | null
          outcome?: string | null
          queued_ttl_expired?: never
          ready_gate_expired?: never
          reason_code?: string | null
          snooze_wake?: never
          total_mutations?: never
        }
        Update: {
          created_at?: string | null
          detail?: Json | null
          hygiene_orphans?: never
          id?: string | null
          latency_ms?: number | null
          outcome?: string | null
          queued_ttl_expired?: never
          ready_gate_expired?: never
          reason_code?: string | null
          snooze_wake?: never
          total_mutations?: never
        }
        Relationships: []
      }
      v_event_loop_guard_outcomes_hourly: {
        Row: {
          bucket_utc: string | null
          n: number | null
          operation: string | null
          outcome: string | null
          reason_code: string | null
        }
        Relationships: []
      }
      v_event_loop_latency_by_operation_outcome_hourly: {
        Row: {
          avg_latency_ms: number | null
          bucket_utc: string | null
          n: number | null
          operation: string | null
          outcome: string | null
          p50_latency_ms: number | null
          p95_latency_ms: number | null
        }
        Relationships: []
      }
      v_event_loop_mark_lobby_events: {
        Row: {
          actor_id: string | null
          created_at: string | null
          detail: Json | null
          event_id: string | null
          id: string | null
          latency_ms: number | null
          outcome: string | null
          promotion: Json | null
          promotion_promoted: string | null
          promotion_reason: string | null
          reason_code: string | null
          session_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string | null
          detail?: Json | null
          event_id?: string | null
          id?: string | null
          latency_ms?: number | null
          outcome?: string | null
          promotion?: never
          promotion_promoted?: never
          promotion_reason?: never
          reason_code?: string | null
          session_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string | null
          detail?: Json | null
          event_id?: string | null
          id?: string | null
          latency_ms?: number | null
          outcome?: string | null
          promotion?: never
          promotion_promoted?: never
          promotion_reason?: never
          reason_code?: string | null
          session_id?: string | null
        }
        Relationships: []
      }
      v_event_loop_mark_lobby_promotion_normalized: {
        Row: {
          actor_id: string | null
          created_at: string | null
          detail: Json | null
          event_id: string | null
          id: string | null
          latency_ms: number | null
          nested_promotion_reason_echo: string | null
          promotion: Json | null
          promotion_derived_outcome: string | null
          promotion_promoted: string | null
          promotion_reason: string | null
          promotion_succeeded: boolean | null
          rpc_completed_observability_outcome: string | null
          session_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string | null
          detail?: Json | null
          event_id?: string | null
          id?: string | null
          latency_ms?: number | null
          nested_promotion_reason_echo?: string | null
          promotion?: never
          promotion_derived_outcome?: never
          promotion_promoted?: never
          promotion_reason?: never
          promotion_succeeded?: never
          rpc_completed_observability_outcome?: string | null
          session_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string | null
          detail?: Json | null
          event_id?: string | null
          id?: string | null
          latency_ms?: number | null
          nested_promotion_reason_echo?: string | null
          promotion?: never
          promotion_derived_outcome?: never
          promotion_promoted?: never
          promotion_reason?: never
          promotion_succeeded?: never
          rpc_completed_observability_outcome?: string | null
          session_id?: string | null
        }
        Relationships: []
      }
      v_event_loop_observability_metric_streams: {
        Row: {
          actor_id: string | null
          created_at: string | null
          detail: Json | null
          event_id: string | null
          id: string | null
          latency_ms: number | null
          metric_stream: string | null
          operation: string | null
          outcome: string | null
          reason_code: string | null
          session_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string | null
          detail?: Json | null
          event_id?: string | null
          id?: string | null
          latency_ms?: number | null
          metric_stream?: never
          operation?: string | null
          outcome?: string | null
          reason_code?: string | null
          session_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string | null
          detail?: Json | null
          event_id?: string | null
          id?: string | null
          latency_ms?: number | null
          metric_stream?: never
          operation?: string | null
          outcome?: string | null
          reason_code?: string | null
          session_id?: string | null
        }
        Relationships: []
      }
      v_event_loop_promotion_events: {
        Row: {
          actor_id: string | null
          created_at: string | null
          detail: Json | null
          detail_step: string | null
          event_id: string | null
          id: string | null
          latency_ms: number | null
          outcome: string | null
          reason_code: string | null
          session_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string | null
          detail?: Json | null
          detail_step?: never
          event_id?: string | null
          id?: string | null
          latency_ms?: number | null
          outcome?: string | null
          reason_code?: string | null
          session_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string | null
          detail?: Json | null
          detail_step?: never
          event_id?: string | null
          id?: string | null
          latency_ms?: number | null
          outcome?: string | null
          reason_code?: string | null
          session_id?: string | null
        }
        Relationships: []
      }
      v_event_loop_promotion_outcomes_hourly: {
        Row: {
          avg_latency_ms: number | null
          bucket_utc: string | null
          n: number | null
          outcome: string | null
          p50_latency_ms: number | null
          p95_latency_ms: number | null
          reason_code: string | null
        }
        Relationships: []
      }
      v_event_loop_swipe_mutual_events: {
        Row: {
          actor_id: string | null
          created_at: string | null
          detail: Json | null
          event_id: string | null
          id: string | null
          immediate: boolean | null
          latency_ms: number | null
          mutual: boolean | null
          outcome: string | null
          reason_code: string | null
          session_id: string | null
          swipe_type: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string | null
          detail?: Json | null
          event_id?: string | null
          id?: string | null
          immediate?: never
          latency_ms?: number | null
          mutual?: never
          outcome?: string | null
          reason_code?: string | null
          session_id?: string | null
          swipe_type?: never
        }
        Update: {
          actor_id?: string | null
          created_at?: string | null
          detail?: Json | null
          event_id?: string | null
          id?: string | null
          immediate?: never
          latency_ms?: number | null
          mutual?: never
          outcome?: string | null
          reason_code?: string | null
          session_id?: string | null
          swipe_type?: never
        }
        Relationships: []
      }
    }
    Functions: {
      _apply_date_plan_event_lock: {
        Args: {
          p_date_plan_id: string
          p_slot_date: string
          p_time_block: string
          p_user_id: string
        }
        Returns: undefined
      }
      _block_hour_range: { Args: { p_time_block: string }; Returns: unknown }
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
          p_selected_slot_keys: string[]
          p_subject: string
          p_suggestion_id: string
          p_viewer: string
        }
        Returns: undefined
      }
      _get_user_tier_capabilities_unchecked: {
        Args: { p_user_id: string }
        Returns: Json
      }
      _get_user_tier_capability_bool_unchecked: {
        Args: { p_capability_key: string; p_user_id: string }
        Returns: boolean
      }
      _get_user_tier_capability_int_unchecked: {
        Args: { p_capability_key: string; p_user_id: string }
        Returns: number
      }
      _get_user_tier_capability_text_array_unchecked: {
        Args: { p_capability_key: string; p_user_id: string }
        Returns: string[]
      }
      _revert_date_plan_event_lock: {
        Args: { p_date_plan_id: string }
        Returns: undefined
      }
      _user_active_conversation_count_unchecked: {
        Args: { p_user_id: string }
        Returns: number
      }
      _user_can_access_event_visibility_unchecked: {
        Args: { p_user_id: string; p_visibility: string }
        Returns: boolean
      }
      _user_monthly_event_join_count_unchecked: {
        Args: { p_user_id: string }
        Returns: number
      }
      activate_profile_vibe_video: {
        Args: { p_user_id: string; p_video_id: string; p_video_status?: string }
        Returns: Json
      }
      admin_adjust_user_credits: {
        Args: {
          p_adjustments: Json
          p_idempotency_key?: string
          p_reason: string
          p_user_id: string
        }
        Returns: Json
      }
      admin_archive_event: {
        Args: {
          p_event_id: string
          p_idempotency_key?: string
          p_reason?: string
        }
        Returns: Json
      }
      admin_archive_event_series: {
        Args: {
          p_idempotency_key?: string
          p_parent_event_id: string
          p_reason?: string
        }
        Returns: Json
      }
      admin_bulk_archive_events: {
        Args: {
          p_event_ids: string[]
          p_idempotency_key?: string
          p_reason?: string
        }
        Returns: Json
      }
      admin_cancel_event: {
        Args: {
          p_event_id: string
          p_idempotency_key?: string
          p_reason?: string
        }
        Returns: Json
      }
      admin_create_data_export_job: {
        Args: {
          p_pii_classification?: string
          p_reason: string
          p_scope: Json
          p_scope_type: string
        }
        Returns: Json
      }
      admin_create_event: {
        Args: { p_idempotency_key?: string; p_payload: Json }
        Returns: Json
      }
      admin_create_event_category: {
        Args: { p_emoji: string; p_label: string; p_sort_order?: number }
        Returns: Json
      }
      admin_create_event_payment_exception: {
        Args: {
          p_checkout_session_id?: string
          p_event_id: string
          p_exception_status?: string
          p_exception_type: string
          p_idempotency_key?: string
          p_notes?: string
          p_profile_id: string
          p_support_ticket_id?: string
        }
        Returns: Json
      }
      admin_create_support_reply: {
        Args: {
          p_idempotency_key?: string
          p_message: string
          p_ticket_id: string
        }
        Returns: Json
      }
      admin_delete_event: {
        Args: {
          p_event_id: string
          p_idempotency_key?: string
          p_reason?: string
        }
        Returns: Json
      }
      admin_delete_notifications: {
        Args: {
          p_filters?: Json
          p_idempotency_key?: string
          p_ids?: string[]
          p_scope: string
        }
        Returns: Json
      }
      admin_delete_push_campaign_draft: {
        Args: { p_campaign_id: string; p_idempotency_key?: string }
        Returns: Json
      }
      admin_end_event: {
        Args: {
          p_event_id: string
          p_idempotency_key?: string
          p_reason?: string
        }
        Returns: Json
      }
      admin_estimate_push_campaign_reach: {
        Args: { p_segment?: Json }
        Returns: Json
      }
      admin_extend_event: {
        Args: {
          p_event_id: string
          p_idempotency_key?: string
          p_minutes: number
          p_reason?: string
        }
        Returns: Json
      }
      admin_generate_recurring_events: {
        Args: {
          p_count: number
          p_idempotency_key?: string
          p_parent_event_id: string
        }
        Returns: Json
      }
      admin_get_admin_permissions: { Args: never; Returns: Json }
      admin_get_authenticity_operations: {
        Args: { p_filters?: Json }
        Returns: Json
      }
      admin_get_cost_capacity_metrics: {
        Args: { p_window_end?: string; p_window_start?: string }
        Returns: Json
      }
      admin_get_dashboard_badge_counts: { Args: never; Returns: Json }
      admin_get_data_export_job: { Args: { p_job_id: string }; Returns: Json }
      admin_get_engagement_analytics: {
        Args: { p_window_end: string; p_window_start: string }
        Returns: Json
      }
      admin_get_entitlement_reconciliation: {
        Args: { p_limit?: number; p_offset?: number; p_user_id?: string }
        Returns: Json
      }
      admin_get_event_confirmed_gender_counts: {
        Args: { p_event_id: string }
        Returns: Json
      }
      admin_get_event_lifecycle_feed: {
        Args: { p_event_id: string }
        Returns: Json
      }
      admin_get_event_liquidity_metrics: {
        Args: {
          p_event_id?: string
          p_window_end?: string
          p_window_start?: string
        }
        Returns: Json
      }
      admin_get_event_live_analytics: {
        Args: { p_event_id: string }
        Returns: Json
      }
      admin_get_event_metrics: { Args: { p_event_id: string }; Returns: Json }
      admin_get_event_post_analytics: {
        Args: { p_event_id: string }
        Returns: Json
      }
      admin_get_experiment_metrics: {
        Args: { p_experiment_key: string }
        Returns: Json
      }
      admin_get_incident_signals: { Args: { p_now?: string }; Returns: Json }
      admin_get_match_message_counts: {
        Args: { p_match_ids: string[] }
        Returns: Json
      }
      admin_get_match_quality_metrics: {
        Args: {
          p_filters?: Json
          p_window_end?: string
          p_window_start?: string
        }
        Returns: Json
      }
      admin_get_match_thread_messages: {
        Args: { p_limit?: number; p_match_id: string; p_user_id: string }
        Returns: Json
      }
      admin_get_notification_counts: { Args: never; Returns: Json }
      admin_get_overview_dashboard: { Args: { p_now?: string }; Returns: Json }
      admin_get_overview_metrics: { Args: { p_now?: string }; Returns: Json }
      admin_get_photo_verification_counts: {
        Args: { p_today_start?: string }
        Returns: Json
      }
      admin_get_product_intelligence_metrics: {
        Args: {
          p_filters?: Json
          p_window_end?: string
          p_window_start?: string
        }
        Returns: Json
      }
      admin_get_provider_health: { Args: { p_now?: string }; Returns: Json }
      admin_get_push_campaigns_read_model: { Args: never; Returns: Json }
      admin_get_push_delivery_metrics: {
        Args: { p_window_end: string; p_window_start: string }
        Returns: Json
      }
      admin_get_quality_scorecard: {
        Args: { p_release_version?: string }
        Returns: Json
      }
      admin_get_rebuild_status: { Args: never; Returns: Json }
      admin_get_reports_read_model: {
        Args: {
          p_limit?: number
          p_search?: string
          p_sort_direction?: string
          p_sort_field?: string
          p_status?: string
        }
        Returns: Json
      }
      admin_get_reports_summary_counts: {
        Args: { p_month_start: string; p_week_start: string }
        Returns: Json
      }
      admin_get_retention_activation_metrics: {
        Args: {
          p_filters?: Json
          p_window_end?: string
          p_window_start?: string
        }
        Returns: Json
      }
      admin_get_revenue_intelligence: {
        Args: {
          p_filters?: Json
          p_window_end?: string
          p_window_start?: string
        }
        Returns: Json
      }
      admin_get_store_operations_metrics: {
        Args: { p_window_end?: string; p_window_start?: string }
        Returns: Json
      }
      admin_get_support_inbox: {
        Args: {
          p_limit?: number
          p_primary_type?: string
          p_priority?: string
          p_search?: string
          p_status?: string
        }
        Returns: Json
      }
      admin_get_support_ticket_thread: {
        Args: { p_ticket_id: string }
        Returns: Json
      }
      admin_get_support_timeline: { Args: { p_user_id: string }; Returns: Json }
      admin_get_system_health: { Args: { p_now?: string }; Returns: Json }
      admin_get_trust_triage_queue: {
        Args: { p_filters?: Json; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      admin_get_user_detail_counts: {
        Args: { p_user_id: string }
        Returns: Json
      }
      admin_get_user_detail_read_model: {
        Args: { p_user_id: string }
        Returns: Json
      }
      admin_get_user_match_threads: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: Json
      }
      admin_get_user_trust_timeline: {
        Args: { p_user_id: string }
        Returns: Json
      }
      admin_go_live_event: {
        Args: {
          p_event_id: string
          p_idempotency_key?: string
          p_reason?: string
        }
        Returns: Json
      }
      admin_has_permission: { Args: { p_permission: string }; Returns: Json }
      admin_idempotency_begin: {
        Args: {
          p_admin_id: string
          p_idempotency_key: string
          p_operation: string
          p_request: Json
        }
        Returns: Json
      }
      admin_idempotency_complete: {
        Args: {
          p_admin_id: string
          p_idempotency_key: string
          p_operation: string
          p_response: Json
        }
        Returns: Json
      }
      admin_json_error: {
        Args: { p_details?: Json; p_error: string; p_message?: string }
        Returns: Json
      }
      admin_json_success: { Args: { p_data?: Json }; Returns: Json }
      admin_jsonb_int_array: { Args: { p_value: Json }; Returns: number[] }
      admin_jsonb_text_array: { Args: { p_value: Json }; Returns: string[] }
      admin_list_account_deletions: {
        Args: { p_limit?: number; p_status?: string }
        Returns: Json
      }
      admin_list_data_export_jobs: {
        Args: { p_filters?: Json; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      admin_list_event_analytics_options: {
        Args: { p_include_archived?: boolean; p_limit?: number }
        Returns: Json
      }
      admin_list_events: {
        Args: { p_filters?: Json; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      admin_list_notifications: {
        Args: { p_filters?: Json; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      admin_list_photo_verifications: {
        Args: { p_limit?: number; p_reviewed_since?: string; p_status: string }
        Returns: Json
      }
      admin_mark_account_deletion_completed: {
        Args: {
          p_idempotency_key?: string
          p_reason?: string
          p_request_id: string
        }
        Returns: Json
      }
      admin_mark_event_attendance: {
        Args: {
          p_attended: boolean
          p_event_id: string
          p_idempotency_key?: string
          p_reason?: string
          p_registration_ids: string[]
        }
        Returns: Json
      }
      admin_mark_notifications_read: {
        Args: {
          p_filters?: Json
          p_idempotency_key?: string
          p_ids?: string[]
          p_scope: string
        }
        Returns: Json
      }
      admin_moderate_user: {
        Args: {
          p_action: string
          p_idempotency_key?: string
          p_message?: string
          p_reason: string
          p_suspension_expires_at?: string
          p_user_id: string
        }
        Returns: Json
      }
      admin_p4_context_summary: { Args: { p_context: Json }; Returns: Json }
      admin_record_moderation_recommendation_decision: {
        Args: {
          p_decision: string
          p_reason: string
          p_recommendation_id: string
        }
        Returns: Json
      }
      admin_remove_event_registration: {
        Args: {
          p_event_id: string
          p_idempotency_key?: string
          p_profile_id: string
          p_reason?: string
        }
        Returns: Json
      }
      admin_resolve_report: {
        Args: {
          p_action: string
          p_idempotency_key?: string
          p_message?: string
          p_reason: string
          p_report_id: string
          p_suspension_expires_at?: string
        }
        Returns: Json
      }
      admin_resolve_report_with_policy: {
        Args: {
          p_action: string
          p_idempotency_key?: string
          p_message?: string
          p_policy_category?: string
          p_reason: string
          p_recommendation_id?: string
          p_report_id: string
          p_suspension_expires_at?: string
        }
        Returns: Json
      }
      admin_review_photo_verification: {
        Args: {
          p_action: string
          p_idempotency_key?: string
          p_rejection_reason?: string
          p_verification_id: string
        }
        Returns: Json
      }
      admin_search_admin_audit_logs: {
        Args: {
          p_action_type?: string
          p_actor_id?: string
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_target_id?: string
          p_target_type?: string
          p_to?: string
        }
        Returns: Json
      }
      admin_search_users: {
        Args: {
          p_filters?: Json
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_sort?: string
        }
        Returns: Json
      }
      admin_send_event_reminder: {
        Args: {
          p_event_id: string
          p_idempotency_key?: string
          p_reason?: string
        }
        Returns: Json
      }
      admin_set_premium_status: {
        Args: {
          p_action: string
          p_idempotency_key?: string
          p_premium_until?: string
          p_reason?: string
          p_subscription_tier?: string
          p_user_id: string
        }
        Returns: Json
      }
      admin_transition_event_payment_exception: {
        Args: {
          p_exception_id: string
          p_exception_status?: string
          p_exception_type?: string
          p_external_refund_reference?: string
          p_idempotency_key?: string
          p_notes?: string
          p_refund_handled_externally?: boolean
          p_resolution?: string
          p_support_ticket_id?: string
        }
        Returns: Json
      }
      admin_unarchive_event: {
        Args: {
          p_event_id: string
          p_idempotency_key?: string
          p_reason?: string
        }
        Returns: Json
      }
      admin_update_event: {
        Args: {
          p_event_id: string
          p_idempotency_key?: string
          p_payload: Json
        }
        Returns: Json
      }
      admin_update_event_category: {
        Args: {
          p_active?: boolean
          p_category_key: string
          p_emoji?: string
          p_label?: string
          p_sort_order?: number
        }
        Returns: Json
      }
      admin_update_experiment_status: {
        Args: { p_experiment_key: string; p_reason: string; p_status: string }
        Returns: Json
      }
      admin_update_support_ticket: {
        Args: {
          p_admin_notes?: string
          p_checkout_session_id?: string
          p_event_id?: string
          p_idempotency_key?: string
          p_priority?: string
          p_set_admin_notes?: boolean
          p_set_checkout_session_id?: boolean
          p_set_event_id?: boolean
          p_status?: string
          p_ticket_id: string
        }
        Returns: Json
      }
      admin_upsert_push_campaign_draft: {
        Args: {
          p_body: string
          p_campaign_id: string
          p_idempotency_key?: string
          p_target_segment: Json
          p_title: string
        }
        Returns: Json
      }
      admin_user_has_permission: {
        Args: { p_permission: string; p_user_id: string }
        Returns: boolean
      }
      admin_validate_event_payload: {
        Args: { p_is_create?: boolean; p_payload: Json }
        Returns: Json
      }
      advance_video_session_vibe_question: {
        Args: { p_session_id: string }
        Returns: Json
      }
      apply_account_deletion_media_hold: {
        Args: { p_user_id: string }
        Returns: Json
      }
      apply_drop_cooldown: {
        Args: {
          p_cooldown_until: string
          p_reason: string
          p_user_a: string
          p_user_b: string
        }
        Returns: {
          cooldown_until: string
          created_at: string | null
          id: string
          reason: string
          user_a_id: string
          user_b_id: string
        }
        SetofOptions: {
          from: "*"
          to: "daily_drop_cooldowns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_referral_attribution: {
        Args: { p_referrer_id: string }
        Returns: Json
      }
      assert_tier_config_override_valid: {
        Args: { p_capability_key: string; p_value: Json }
        Returns: undefined
      }
      attach_chat_media_asset_to_match: {
        Args: { p_asset_id: string; p_match_id: string }
        Returns: Json
      }
      audit_active_video_date_surface_conflicts: {
        Args: never
        Returns: {
          active_session_count: number
          profile_id: string
          session_ids: string[]
        }[]
      }
      backfill_chat_message_media_lifecycle: {
        Args: { p_limit?: number }
        Returns: Json
      }
      block_user_with_cleanup: {
        Args: { p_blocked_id: string; p_match_id?: string; p_reason?: string }
        Returns: Json
      }
      calculate_vibe_score: { Args: { p_user_id: string }; Returns: Json }
      calculate_vibe_score_from_row: {
        Args: { p: Database["public"]["Tables"]["profiles"]["Row"] }
        Returns: Json
      }
      can_view_event_registration_profile: {
        Args: { p_event_id: string; p_profile_id: string; p_viewer_id: string }
        Returns: boolean
      }
      can_view_profile_photo: {
        Args: { photo_owner_id: string }
        Returns: boolean
      }
      can_view_profile_presence: {
        Args: {
          p_event_id?: string
          p_target_user_id: string
          p_viewer_id: string
        }
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
      claim_due_event_reminder_queue_rows: {
        Args: { p_limit?: number; p_stale_after_seconds?: number }
        Returns: {
          delivery_attempts: number
          event_id: string
          event_title: string
          id: string
          last_error_reason: string
          profile_id: string
          reminder_type: string
        }[]
      }
      claim_growth_attribution: {
        Args: { p_context?: Json; p_referral_token: string }
        Returns: Json
      }
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
      claim_notification_outbox_batch: {
        Args: { p_limit: number }
        Returns: {
          attempt_count: number
          body: string | null
          bypass_preferences: boolean
          category: string
          completed_at: string | null
          created_at: string
          data: Json
          event_reminder_queue_id: string | null
          id: string
          idempotency_key: string
          image_url: string | null
          last_error: string | null
          next_attempt_at: string
          onesignal_notification_id: string | null
          outcome: string | null
          source: string
          status: string
          suppressed_reason: string | null
          title: string | null
          updated_at: string
          user_id: string
          waitlist_promotion_queue_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "notification_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_post_date_pending_verdict_reminders: {
        Args: { p_limit?: number }
        Returns: {
          event_id: string
          first_detected_at: string
          missing_user_id: string
          reminder_sent_at: string
          session_id: string
          submitted_by: string
        }[]
      }
      claim_video_date_surface: {
        Args: {
          p_client_instance_id: string
          p_session_id: string
          p_surface: string
          p_takeover?: boolean
          p_ttl_seconds?: number
        }
        Returns: Json
      }
      classify_stale_vibe_video_uploads: {
        Args: { p_limit?: number; p_stale_minutes?: number }
        Returns: Json
      }
      clear_expired_pauses: { Args: never; Returns: number }
      clear_match_notification_mute: {
        Args: { p_match_id: string }
        Returns: Json
      }
      clear_my_location_data: { Args: never; Returns: Json }
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
      confirm_vde_prepared_202605031300_base: {
        Args: {
          p_entry_attempt_id?: string
          p_room_name: string
          p_room_url: string
          p_session_id: string
        }
        Returns: Json
      }
      confirm_video_date_entry_prepared: {
        Args: {
          p_entry_attempt_id?: string
          p_room_name: string
          p_room_url: string
          p_session_id: string
        }
        Returns: Json
      }
      confirm_video_date_entry_prepared_20260501200000_event_inactive: {
        Args: {
          p_entry_attempt_id?: string
          p_room_name: string
          p_room_url: string
          p_session_id: string
        }
        Returns: Json
      }
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
      daily_drop_cron_health: { Args: never; Returns: Json }
      daily_drop_transition: {
        Args: { p_action: string; p_drop_id: string; p_text?: string }
        Returns: Json
      }
      daily_drops_generation_ran_today: { Args: never; Returns: boolean }
      date_plan_mark_complete_v2: { Args: { p_plan_id: string }; Returns: Json }
      date_suggestion_apply: {
        Args: { p_action: string; p_payload: Json }
        Returns: Json
      }
      date_suggestion_apply_legacy_dispatch_20260512: {
        Args: { p_action: string; p_payload: Json }
        Returns: Json
      }
      date_suggestion_apply_v2: {
        Args: { p_action: string; p_payload: Json }
        Returns: Json
      }
      date_suggestion_apply_v2_legacy_dispatch_20260512: {
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
      detect_post_date_half_verdict_timeouts: {
        Args: { p_limit?: number; p_older_than?: string }
        Returns: number
      }
      dismiss_notification: {
        Args: { notification_id: string }
        Returns: boolean
      }
      drain_match_queue: { Args: { p_event_id: string }; Returns: Json }
      drain_match_queue_20260501180000_active_base: {
        Args: { p_event_id: string }
        Returns: Json
      }
      drain_match_queue_20260502083000_active_base: {
        Args: { p_event_id: string }
        Returns: Json
      }
      enqueue_media_delete: {
        Args: { p_asset_id: string; p_job_type?: string }
        Returns: Json
      }
      enqueue_vibe_video_orphan_delete: {
        Args: {
          p_context?: Json
          p_reason: string
          p_user_id: string
          p_video_id: string
        }
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
      event_category_keys_are_valid: {
        Args: { p_keys: string[] }
        Returns: boolean
      }
      event_category_slug: { Args: { p_label: string }; Returns: string }
      event_lobby_video_session_blocks_new_match: {
        Args: {
          p_date_started_at: string
          p_ended_at: string
          p_handshake_started_at: string
          p_phase: string
          p_ready_gate_status: string
          p_state: string
        }
        Returns: boolean
      }
      expire_due_joined_video_date_handshakes_bounded: {
        Args: { p_limit?: number }
        Returns: Json
      }
      expire_pending_daily_drops: { Args: never; Returns: Json }
      expire_stale_match_calls: { Args: never; Returns: number }
      expire_stale_video_date_partial_joins_bounded: {
        Args: { p_limit?: number }
        Returns: Json
      }
      expire_stale_video_date_phases: { Args: never; Returns: Json }
      expire_stale_video_date_phases_bounded: {
        Args: { p_limit?: number }
        Returns: Json
      }
      expire_stale_video_sessions: { Args: never; Returns: number }
      expire_stale_video_sessions_20260501103000_unbounded: {
        Args: never
        Returns: number
      }
      expire_stale_video_sessions_bounded: {
        Args: { p_limit?: number }
        Returns: number
      }
      expire_stale_video_sessions_bounded_202605031300_base: {
        Args: { p_limit?: number }
        Returns: number
      }
      expire_stale_vsessions_bounded_202605060900_base: {
        Args: { p_limit?: number }
        Returns: number
      }
      expire_vd_phases_base_20260501133000: {
        Args: { p_limit?: number }
        Returns: Json
      }
      expire_vd_phases_base_20260502143000: {
        Args: { p_limit?: number }
        Returns: Json
      }
      expire_video_date_reconnect_graces: { Args: never; Returns: number }
      extract_chat_image_path_from_content: {
        Args: { p_content: string }
        Returns: string
      }
      finalize_due_events: {
        Args: { p_limit?: number; p_now?: string }
        Returns: Json
      }
      finalize_onboarding: {
        Args: { p_final_data?: Json; p_user_id: string }
        Returns: Json
      }
      finalize_video_date_handshake_deadline: {
        Args: {
          p_actor?: string
          p_reason?: string
          p_session_id: string
          p_source?: string
        }
        Returns: Json
      }
      find_mystery_match: {
        Args: { p_event_id: string; p_user_id: string }
        Returns: Json
      }
      find_mystery_match_20260501180000_active_base: {
        Args: { p_event_id: string; p_user_id: string }
        Returns: Json
      }
      find_mystery_match_20260502083000_active_base: {
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
      get_active_session_context: {
        Args: { p_event_id?: string }
        Returns: Json
      }
      get_chat_partner_presence: {
        Args: { p_match_id: string }
        Returns: {
          can_view_presence: boolean
          is_online: boolean
          last_seen_at: string
          target_user_id: string
        }[]
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
          availability_state: string
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
          photo_verified: boolean
          photos: string[]
          premium_badge: string
          primary_photo_path: string
          profile_id: string
          queue_status: string
          shared_vibe_count: number
          tagline: string
        }[]
      }
      get_event_deck_20260501180000_active_base: {
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
      get_event_lobby_active_state: {
        Args: { p_event_id: string; p_now?: string }
        Returns: {
          event_status: string
          is_active: boolean
          reason: string
        }[]
      }
      get_event_lobby_inactive_reason: {
        Args: { p_event_id: string }
        Returns: string
      }
      get_event_visible_attendees: {
        Args: { p_event_id: string; p_viewer_id: string }
        Returns: string[]
      }
      get_home_unread_summary: {
        Args: never
        Returns: {
          match_count: number
          message_count: number
        }[]
      }
      get_media_worker_cron_job_status: {
        Args: { p_job_name?: string }
        Returns: Json
      }
      get_media_worker_cron_run_history: {
        Args: { p_job_name?: string; p_run_limit?: number }
        Returns: Json
      }
      get_media_worker_cron_status: {
        Args: { p_job_name?: string; p_run_limit?: number }
        Returns: Json
      }
      get_my_blocked_users: {
        Args: never
        Returns: {
          avatar_url: string
          blocked_id: string
          blocker_id: string
          created_at: string
          display_name: string
          id: string
          photo_url: string
          reason: string
        }[]
      }
      get_my_date_plan_feedback_status: {
        Args: { p_plan_id: string }
        Returns: Json
      }
      get_my_location_data: {
        Args: never
        Returns: {
          country: string
          lat: number
          lng: number
          location: string
          location_data: Json
        }[]
      }
      get_my_privacy_settings: {
        Args: never
        Returns: {
          activity_status_visibility: string
          discoverable: boolean
          discovery_audience: string
          discovery_mode: string
          discovery_snooze_until: string
          distance_visibility: string
          event_attendance_visibility: string
          show_online_status: boolean
        }[]
      }
      get_onboarding_draft: { Args: { p_user_id: string }; Returns: Json }
      get_or_seed_video_session_vibe_questions: {
        Args: { p_questions: Json; p_session_id: string }
        Returns: Json
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
      get_own_pii: {
        Args: { p_user_id: string }
        Returns: {
          phone_number: string
          phone_verified: boolean
          verified_email: string
        }[]
      }
      get_photo_sessions: { Args: { p_user_id: string }; Returns: Json }
      get_profile_distance_label_for_viewer: {
        Args: { p_target_id: string }
        Returns: string
      }
      get_profile_for_viewer: { Args: { p_target_id: string }; Returns: Json }
      get_profile_presence_for_viewer: {
        Args: { p_event_id?: string; p_target_user_id: string }
        Returns: {
          can_view_presence: boolean
          is_online: boolean
          last_seen_at: string
          target_user_id: string
        }[]
      }
      get_shared_schedule_for_date_planning: {
        Args: { p_match_id: string; p_subject_user_id: string }
        Returns: Json
      }
      get_tier_capabilities: { Args: { p_tier_id: string }; Returns: Json }
      get_user_subscription_status: {
        Args: { p_user_id: string }
        Returns: string
      }
      get_user_tier: { Args: { p_user_id: string }; Returns: string }
      get_user_tier_capabilities: { Args: { p_user_id: string }; Returns: Json }
      get_video_date_session_timeline: {
        Args: { p_session_id: string }
        Returns: {
          actor_id: string
          detail: Json
          event_id: string
          occurred_at: string
          operation: string
          outcome: string
          reason_code: string
          session_id: string
          source: string
          timeline_seq: number
        }[]
      }
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
          categories: Json
          category_keys: string[]
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
          vibes: string[]
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
      handle_swipe_20260501180000_active_base: {
        Args: {
          p_actor_id: string
          p_event_id: string
          p_swipe_type: string
          p_target_id: string
        }
        Returns: Json
      }
      handle_swipe_20260501210000_idempotency_base: {
        Args: {
          p_actor_id: string
          p_event_id: string
          p_swipe_type: string
          p_target_id: string
        }
        Returns: Json
      }
      handle_swipe_20260502083000_ready_queue_base: {
        Args: {
          p_actor_id: string
          p_event_id: string
          p_swipe_type: string
          p_target_id: string
        }
        Returns: Json
      }
      handle_swipe_20260503090000_encounter_guard_base: {
        Args: {
          p_actor_id: string
          p_event_id: string
          p_swipe_type: string
          p_target_id: string
        }
        Returns: Json
      }
      handle_swipe_20260505220000_queued_browse_base: {
        Args: {
          p_actor_id: string
          p_event_id: string
          p_swipe_type: string
          p_target_id: string
        }
        Returns: Json
      }
      handle_swipe_20260506090000_stale_room_base: {
        Args: {
          p_actor_id: string
          p_event_id: string
          p_swipe_type: string
          p_target_id: string
        }
        Returns: Json
      }
      handle_swipe_20260507190000_tier_authority_base: {
        Args: {
          p_actor_id: string
          p_event_id: string
          p_swipe_type: string
          p_target_id: string
        }
        Returns: Json
      }
      handle_swipe_20260508140000_block_race_base: {
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
      infer_event_category_keys_from_legacy_tags: {
        Args: { p_tags: string[] }
        Returns: string[]
      }
      is_blocked: {
        Args: { user1_id: string; user2_id: string }
        Returns: boolean
      }
      is_event_lobby_active: { Args: { p_event_id: string }; Returns: boolean }
      is_profile_discoverable: {
        Args: { p_target_id: string; p_viewer_id?: string }
        Returns: boolean
      }
      is_profile_hidden: { Args: { p_profile_id: string }; Returns: boolean }
      is_registered_for_event: {
        Args: { _event_id: string; _user_id: string }
        Returns: boolean
      }
      is_valid_bunny_video_uid: { Args: { p_uid: string }; Returns: boolean }
      join_matching_queue: {
        Args: { p_event_id: string; p_user_id: string }
        Returns: Json
      }
      leave_matching_queue: { Args: { p_event_id: string }; Returns: Json }
      lock_event_lobby_scheduled_active_state: {
        Args: { p_event_id: string; p_now?: string }
        Returns: {
          event_status: string
          is_active: boolean
          reason: string
        }[]
      }
      log_admin_action: {
        Args: {
          p_action_type: string
          p_details?: Json
          p_target_id?: string
          p_target_type: string
        }
        Returns: string
      }
      mark_all_notifications_read: { Args: never; Returns: number }
      mark_chat_match_participant_deletion_pending: {
        Args: { p_match_id: string; p_pending_at?: string; p_user_id: string }
        Returns: Json
      }
      mark_event_participant_heartbeat: {
        Args: { p_event_id: string }
        Returns: boolean
      }
      mark_event_reminder_queue_row_delivered: {
        Args: { p_id: string }
        Returns: boolean
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
      mark_my_activity_seen: { Args: never; Returns: boolean }
      mark_notification_opened: {
        Args: { notification_id: string }
        Returns: boolean
      }
      mark_notification_read: {
        Args: { notification_id: string }
        Returns: boolean
      }
      mark_notifications_seen: {
        Args: { notification_ids: string[] }
        Returns: number
      }
      mark_photo_deleted: {
        Args: { p_storage_path: string; p_user_id: string }
        Returns: Json
      }
      mark_photo_drafts_deleted: { Args: { p_paths: string[] }; Returns: Json }
      mark_post_date_pending_verdicts_stale: {
        Args: { p_limit?: number; p_older_than?: string }
        Returns: number
      }
      mark_stale_vibe_video_uploads_failed: {
        Args: { p_limit?: number; p_stale_minutes?: number }
        Returns: Json
      }
      mark_support_reply_read: {
        Args: { p_reply_id: string }
        Returns: undefined
      }
      mark_video_date_daily_joined: {
        Args: { p_session_id: string }
        Returns: Json
      }
      match_call_transition: {
        Args: { p_action: string; p_call_id: string; p_reason?: string }
        Returns: Json
      }
      media_compute_purge_after: {
        Args: { p_deleted_at?: string; p_media_family: string }
        Returns: string
      }
      normalize_event_cover_provider_path: {
        Args: { p_value: string }
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
      notification_outbox_complete_waitlist: {
        Args: { p_completed_at: string; p_queue_id: string }
        Returns: undefined
      }
      notification_outbox_enqueue: {
        Args: {
          p_body: string
          p_bypass_preferences: boolean
          p_category: string
          p_data: Json
          p_event_reminder_queue_id: string
          p_idempotency_key: string
          p_image_url: string
          p_source: string
          p_title: string
          p_user_id: string
          p_waitlist_promotion_queue_id: string
        }
        Returns: string
      }
      notification_outbox_reclaim_stale_minutes: {
        Args: { p_stale_minutes: number }
        Returns: number
      }
      profile_event_attendance_visible_to_viewer: {
        Args: { p_target_id: string; p_viewer_id: string }
        Returns: boolean
      }
      profile_has_established_access: {
        Args: { p_target_id: string; p_viewer_id: string }
        Returns: boolean
      }
      profile_location_coord: {
        Args: { p_key: string; p_location_data: Json }
        Returns: number
      }
      profiles_have_qualifying_shared_event: {
        Args: { p_event_id?: string; p_profile_a: string; p_profile_b: string }
        Returns: boolean
      }
      profiles_have_safety_block: {
        Args: { p_profile_a: string; p_profile_b: string }
        Returns: boolean
      }
      promote_purgeable_assets: {
        Args: { p_family_filter?: string; p_limit?: number }
        Returns: number
      }
      promote_ready_gate_202605030900_base: {
        Args: { p_event_id: string; p_uid: string }
        Returns: Json
      }
      promote_ready_gate_20260505220000_queued_browse_base: {
        Args: { p_event_id: string; p_uid: string }
        Returns: Json
      }
      promote_ready_gate_if_eligible: {
        Args: { p_event_id: string; p_uid: string }
        Returns: Json
      }
      promote_ready_gate_if_eligible_20260501180000_active_base: {
        Args: { p_event_id: string; p_uid: string }
        Returns: Json
      }
      promote_ready_gate_if_eligible_20260502083000_ready_queue_base: {
        Args: { p_event_id: string; p_uid: string }
        Returns: Json
      }
      promote_ready_gate_if_eligible_20260505223000_lock_order_base: {
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
      prune_event_loop_observability_events: {
        Args: { p_batch_limit?: number; p_retention_days?: number }
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
      ready_gate_transition_20260501135000_observability_base: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      ready_gate_transition_20260501170000_both_ready_grace_base: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      ready_gate_transition_20260501190000_expiry_rowcount_prior: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      ready_gate_transition_20260501200000_event_inactive_base: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      ready_gate_transition_20260505140000_pre_ready_room_metadata_ba: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      ready_gate_transition_20260505154500_preserve_after_ready_room_: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      ready_gate_transition_20260505203000_registration_desync_base: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      ready_gate_transition_20260505214500_result_status_base: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      recompute_profile_subscription_entitlement: {
        Args: { p_user_id: string }
        Returns: Json
      }
      record_event_loop_observability: {
        Args: {
          p_actor_id: string
          p_detail: Json
          p_event_id: string
          p_latency_ms: number
          p_operation: string
          p_outcome: string
          p_reason_code: string
          p_session_id: string
        }
        Returns: undefined
      }
      record_experiment_exposure: {
        Args: {
          p_context?: Json
          p_experiment_key: string
          p_surface: string
          p_variant_key: string
        }
        Returns: Json
      }
      record_growth_attribution_event: {
        Args: {
          p_context?: Json
          p_event_type?: string
          p_referral_token?: string
          p_surface?: string
        }
        Returns: Json
      }
      record_post_date_pending_verdict_reminder_result: {
        Args: { p_error?: string; p_session_id: string; p_success: boolean }
        Returns: Json
      }
      record_public_account_deletion_request: {
        Args: { p_email_hash: string; p_ip_hash: string }
        Returns: Json
      }
      record_vd_launch_latency_202605061020_base: {
        Args: {
          p_checkpoint: string
          p_latency_ms?: number
          p_payload?: Json
          p_session_id: string
        }
        Returns: Json
      }
      record_video_date_client_stuck_observability: {
        Args: {
          p_event_name: string
          p_latency_ms?: number
          p_payload?: Json
          p_session_id: string
        }
        Returns: Json
      }
      record_video_date_launch_latency_checkpoint: {
        Args: {
          p_checkpoint: string
          p_latency_ms?: number
          p_payload?: Json
          p_session_id: string
        }
        Returns: Json
      }
      record_video_date_launch_latency_checkpoint_20260505214500_rpc_: {
        Args: {
          p_checkpoint: string
          p_latency_ms?: number
          p_payload?: Json
          p_session_id: string
        }
        Returns: Json
      }
      refresh_my_vibe_score: { Args: never; Returns: Json }
      refund_failed_video_date: {
        Args: { p_session_id: string }
        Returns: Json
      }
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
      release_event_reminder_queue_row_on_failure: {
        Args: { p_error_reason: string; p_id: string }
        Returns: boolean
      }
      release_media_reference: {
        Args: { p_reference_id: string; p_released_by?: string }
        Returns: Json
      }
      release_video_date_surface_claim: {
        Args: { p_client_instance_id: string; p_session_id: string }
        Returns: Json
      }
      repair_event_cover_media_lifecycle: {
        Args: { p_limit?: number }
        Returns: Json
      }
      repair_stale_video_date_prepare_entries: {
        Args: { p_limit?: number }
        Returns: number
      }
      repair_stale_video_date_prepare_entries_20260501170000_both_joi: {
        Args: { p_limit?: number }
        Returns: number
      }
      replenish_monthly_credits: { Args: never; Returns: Json }
      requeue_stale_media_delete_jobs: {
        Args: { p_stale_minutes?: number }
        Returns: number
      }
      reset_tier_config_override: {
        Args: { p_capability_key: string; p_tier_id: string }
        Returns: undefined
      }
      resolve_entry_state: { Args: never; Returns: Json }
      resolve_experiment_assignment: {
        Args: { p_context?: Json; p_experiment_key: string }
        Returns: Json
      }
      resolve_post_date_next_surface: {
        Args: { p_session_id: string }
        Returns: Json
      }
      resolve_tier_capability: {
        Args: { p_capability_key: string; p_tier_id: string }
        Returns: Json
      }
      restore_chat_match_participant: {
        Args: { p_match_id: string; p_user_id: string }
        Returns: Json
      }
      retry_failed_media_delete_jobs: {
        Args: {
          p_family?: string
          p_limit?: number
          p_reset_attempts?: boolean
          p_status?: string
        }
        Returns: number
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
      select_pending_cooldown_pairs: {
        Args: never
        Returns: {
          drop_status: string
          expired_at: string
          user_a_id: string
          user_b_id: string
        }[]
      }
      send_event_reminders: { Args: never; Returns: undefined }
      set_match_archive_state: {
        Args: { p_archived: boolean; p_match_id: string }
        Returns: Json
      }
      set_match_notification_mute: {
        Args: { p_duration: string; p_match_id: string }
        Returns: Json
      }
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
      soft_delete_orphan_event_cover_assets: {
        Args: { p_limit?: number }
        Returns: number
      }
      spend_video_date_credit_extension: {
        Args: {
          p_credit_type: string
          p_idempotency_key?: string
          p_session_id: string
        }
        Returns: Json
      }
      submit_date_plan_feedback: {
        Args: {
          p_did_meet: string
          p_felt_safe: string
          p_free_text?: string
          p_plan_id: string
          p_profile_accurate?: string
          p_would_meet_again?: string
        }
        Returns: Json
      }
      submit_post_date_safety_report_v1: {
        Args: {
          p_idempotency_key: string
          p_safety_report: Json
          p_session_id: string
        }
        Returns: Json
      }
      submit_post_date_verdict: {
        Args: { p_liked: boolean; p_session_id: string }
        Returns: Json
      }
      submit_post_date_verdict_v2: {
        Args: {
          p_idempotency_key: string
          p_liked: boolean
          p_safety_report?: Json
          p_session_id: string
        }
        Returns: Json
      }
      submit_user_report: {
        Args: {
          p_also_block?: boolean
          p_details?: string
          p_reason: string
          p_reported_id: string
        }
        Returns: Json
      }
      summarize_media_lifecycle_health: { Args: never; Returns: Json }
      summarize_media_lifecycle_snapshot: { Args: never; Returns: Json }
      sync_chat_message_media: { Args: { p_message_id: string }; Returns: Json }
      sync_event_cover_media_lifecycle: {
        Args: { p_event_id: string }
        Returns: Json
      }
      sync_profile_photo_media: {
        Args: { p_avatar_path?: string; p_photos: string[]; p_user_id: string }
        Returns: Json
      }
      terminalize_event_ready_gates: {
        Args: { p_event_id: string; p_reason?: string }
        Returns: Json
      }
      terminalize_stale_pre_date_ready_gate_blockers: {
        Args: { p_limit?: number; p_reason?: string }
        Returns: number
      }
      tier_capability_default: {
        Args: { p_capability_key: string; p_tier_id: string }
        Returns: Json
      }
      tier_capability_type: {
        Args: { p_capability_key: string }
        Returns: string | null
      }
      tier_config_override_value_is_valid: {
        Args: { p_capability_key: string; p_value: Json }
        Returns: boolean
      }
      unblock_user: { Args: { p_blocked_id: string }; Returns: Json }
      unclaim_stale_event_reminder_queue_rows: {
        Args: { p_limit?: number; p_stale_after_seconds?: number }
        Returns: number
      }
      unmatch_match: { Args: { p_match_id: string }; Returns: Json }
      update_media_session_status: {
        Args: {
          p_error_detail?: string
          p_new_status: string
          p_provider_id: string
        }
        Returns: Json
      }
      update_my_privacy_settings: {
        Args: { p_patch: Json }
        Returns: {
          activity_status_visibility: string
          discoverable: boolean
          discovery_audience: string
          discovery_mode: string
          discovery_snooze_until: string
          distance_visibility: string
          event_attendance_visibility: string
          show_online_status: boolean
        }[]
      }
      update_onboarding_stage: {
        Args: { p_stage: string; p_user_id: string }
        Returns: undefined
      }
      update_participant_status: {
        Args: { p_event_id: string; p_status: string }
        Returns: undefined
      }
      update_post_date_feedback_details: {
        Args: { p_patch: Json; p_session_id: string }
        Returns: Json
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
      verify_event_ticket_checkout_intent: {
        Args: {
          p_amount_total: number
          p_checkout_session_id: string
          p_currency: string
          p_event_id: string
          p_profile_id: string
          p_stripe_event_id?: string
        }
        Returns: Json
      }
      video_date_client_stuck_safe_bool: {
        Args: { p_value: string }
        Returns: boolean
      }
      video_date_client_stuck_safe_int: {
        Args: { p_max?: number; p_min?: number; p_value: string }
        Returns: number
      }
      video_date_client_stuck_safe_text: {
        Args: { p_max_len?: number; p_value: string }
        Returns: string
      }
      video_date_launch_latency_safe_bool: {
        Args: { p_value: string }
        Returns: boolean
      }
      video_date_launch_latency_safe_int: {
        Args: { p_max?: number; p_min?: number; p_value: string }
        Returns: number
      }
      video_date_launch_latency_safe_text: {
        Args: { p_max_len?: number; p_value: string }
        Returns: string
      }
      video_date_pair_has_terminal_encounter: {
        Args: {
          p_event_id: string
          p_exclude_session_id?: string
          p_user_a: string
          p_user_b: string
        }
        Returns: boolean
      }
      video_date_session_has_encounter_exposure: {
        Args: {
          p_date_started_at: string
          p_participant_1_joined_at: string
          p_participant_2_joined_at: string
          p_phase: string
          p_state: string
        }
        Returns: boolean
      }
      video_date_session_is_active_surface: {
        Args: { p_ended_at: string; p_phase: string; p_state: string }
        Returns: boolean
      }
      video_date_session_is_post_date_survey_eligible: {
        Args: {
          p_date_started_at: string
          p_ended_at: string
          p_ended_reason: string
          p_participant_1_joined_at: string
          p_participant_2_joined_at: string
          p_phase: string
          p_state: string
        }
        Returns: boolean
      }
      video_date_transition: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      video_date_transition_20260430180000_last_chance_grace_10s: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      video_date_transition_20260501091000_pre_date_end_cleanup: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      video_date_transition_20260501103000_prepare_entry_queue_guard: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      video_date_transition_20260501110000_provider_atomic_base: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      video_date_transition_20260501145000_peer_missing_end_base: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      video_date_transition_20260501200000_event_inactive_base: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      video_date_transition_20260502143000_handshake_deadline_base: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      video_date_transition_20260503110000_survey_continuity_base: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      video_date_transition_20260503130000_prepare_lease_base: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      video_date_transition_20260505153000_prepare_payload_base: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      video_session_blocks_global_active_conflict: {
        Args: {
          p_date_started_at: string
          p_ended_at: string
          p_event_id: string
          p_handshake_started_at: string
          p_participant_1_joined_at: string
          p_participant_2_joined_at: string
          p_phase: string
          p_prepare_entry_expires_at: string
          p_queued_expires_at: string
          p_ready_gate_expires_at: string
          p_ready_gate_status: string
          p_snooze_expires_at: string
          p_state: string
        }
        Returns: boolean
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
