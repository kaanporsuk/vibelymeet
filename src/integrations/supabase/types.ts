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
      account_deletion_completion_jobs: {
        Row: {
          attempts: number
          auth_delete_completed_at: string | null
          blocked_reason: string | null
          completed_at: string | null
          created_at: string
          deletion_request_id: string
          error_code: string | null
          id: string
          last_error: string | null
          last_error_at: string | null
          lease_expires_at: string | null
          legacy_checkpoint: boolean
          max_attempts: number
          media_cleanup_completed_at: string | null
          metadata: Json
          next_retry_at: string
          pii_scrub_completed_at: string | null
          provider_cleanup_completed_at: string | null
          provider_cleanup_provider_id: string | null
          request_reason: string | null
          requested_by: string | null
          state: string
          updated_at: string
          user_id: string
          worker_id: string | null
        }
        Insert: {
          attempts?: number
          auth_delete_completed_at?: string | null
          blocked_reason?: string | null
          completed_at?: string | null
          created_at?: string
          deletion_request_id: string
          error_code?: string | null
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          lease_expires_at?: string | null
          legacy_checkpoint?: boolean
          max_attempts?: number
          media_cleanup_completed_at?: string | null
          metadata?: Json
          next_retry_at?: string
          pii_scrub_completed_at?: string | null
          provider_cleanup_completed_at?: string | null
          provider_cleanup_provider_id?: string | null
          request_reason?: string | null
          requested_by?: string | null
          state?: string
          updated_at?: string
          user_id: string
          worker_id?: string | null
        }
        Update: {
          attempts?: number
          auth_delete_completed_at?: string | null
          blocked_reason?: string | null
          completed_at?: string | null
          created_at?: string
          deletion_request_id?: string
          error_code?: string | null
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          lease_expires_at?: string | null
          legacy_checkpoint?: boolean
          max_attempts?: number
          media_cleanup_completed_at?: string | null
          metadata?: Json
          next_retry_at?: string
          pii_scrub_completed_at?: string | null
          provider_cleanup_completed_at?: string | null
          provider_cleanup_provider_id?: string | null
          request_reason?: string | null
          requested_by?: string | null
          state?: string
          updated_at?: string
          user_id?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_deletion_completion_jobs_deletion_request_id_fkey"
            columns: ["deletion_request_id"]
            isOneToOne: true
            referencedRelation: "account_deletion_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      account_deletion_reauth_challenges: {
        Row: {
          channel: string
          code_hash: string | null
          consumed_at: string | null
          created_at: string
          destination_hash: string
          expires_at: string
          failed_attempts: number
          id: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          channel: string
          code_hash?: string | null
          consumed_at?: string | null
          created_at?: string
          destination_hash: string
          expires_at: string
          failed_attempts?: number
          id?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          channel?: string
          code_hash?: string | null
          consumed_at?: string | null
          created_at?: string
          destination_hash?: string
          expires_at?: string
          failed_attempts?: number
          id?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: []
      }
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
          action_outcome: string | null
          action_type: string
          admin_id: string | null
          correlation_id: string | null
          created_at: string
          details: Json | null
          error_code: string | null
          id: string
          request_id: string | null
          target_id: string | null
          target_type: string
        }
        Insert: {
          action_outcome?: string | null
          action_type: string
          admin_id?: string | null
          correlation_id?: string | null
          created_at?: string
          details?: Json | null
          error_code?: string | null
          id?: string
          request_id?: string | null
          target_id?: string | null
          target_type: string
        }
        Update: {
          action_outcome?: string | null
          action_type?: string
          admin_id?: string | null
          correlation_id?: string | null
          created_at?: string
          details?: Json | null
          error_code?: string | null
          id?: string
          request_id?: string | null
          target_id?: string | null
          target_type?: string
        }
        Relationships: []
      }
      admin_durable_worker_runs: {
        Row: {
          action: string | null
          batch_size: number | null
          created_at: string
          finished_at: string | null
          last_error: string | null
          last_heartbeat_at: string | null
          result: Json | null
          started_at: string | null
          status: string
          updated_at: string
          worker_id: string | null
          worker_name: string
        }
        Insert: {
          action?: string | null
          batch_size?: number | null
          created_at?: string
          finished_at?: string | null
          last_error?: string | null
          last_heartbeat_at?: string | null
          result?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
          worker_id?: string | null
          worker_name: string
        }
        Update: {
          action?: string | null
          batch_size?: number | null
          created_at?: string
          finished_at?: string | null
          last_error?: string | null
          last_heartbeat_at?: string | null
          result?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
          worker_id?: string | null
          worker_name?: string
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
      admin_session_invalidation_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json
          previous_role: Database["public"]["Enums"]["app_role"] | null
          reason: string | null
          role: Database["public"]["Enums"]["app_role"] | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          previous_role?: Database["public"]["Enums"]["app_role"] | null
          reason?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          previous_role?: Database["public"]["Enums"]["app_role"] | null
          reason?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
          user_id?: string
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
      bunny_cdn_health_state: {
        Row: {
          alerted_at: string | null
          consecutive_failures: number
          last_checked_at: string
          last_error: string | null
          last_http_status: number | null
          last_status: string
          probe: string
        }
        Insert: {
          alerted_at?: string | null
          consecutive_failures?: number
          last_checked_at?: string
          last_error?: string | null
          last_http_status?: number | null
          last_status?: string
          probe: string
        }
        Update: {
          alerted_at?: string | null
          consecutive_failures?: number
          last_checked_at?: string
          last_error?: string | null
          last_http_status?: number | null
          last_status?: string
          probe?: string
        }
        Relationships: []
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
      chat_vibe_clip_uploads: {
        Row: {
          aspect_ratio: number | null
          captions: Json | null
          client_request_id: string
          created_at: string
          duration_ms: number
          encrypted_media: Json | null
          error_detail: string | null
          expires_at: string
          id: string
          match_id: string
          media_asset_id: string | null
          mime_type: string | null
          provider_object_id: string
          published_message_id: string | null
          recovery_dismissed_at: string | null
          recovery_dismissed_by: string | null
          recovery_dismissed_reason: string | null
          sender_id: string
          source_bytes: number | null
          status: string
          updated_at: string
        }
        Insert: {
          aspect_ratio?: number | null
          captions?: Json | null
          client_request_id: string
          created_at?: string
          duration_ms: number
          encrypted_media?: Json | null
          error_detail?: string | null
          expires_at: string
          id?: string
          match_id: string
          media_asset_id?: string | null
          mime_type?: string | null
          provider_object_id: string
          published_message_id?: string | null
          recovery_dismissed_at?: string | null
          recovery_dismissed_by?: string | null
          recovery_dismissed_reason?: string | null
          sender_id: string
          source_bytes?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          aspect_ratio?: number | null
          captions?: Json | null
          client_request_id?: string
          created_at?: string
          duration_ms?: number
          encrypted_media?: Json | null
          error_detail?: string | null
          expires_at?: string
          id?: string
          match_id?: string
          media_asset_id?: string | null
          mime_type?: string | null
          provider_object_id?: string
          published_message_id?: string | null
          recovery_dismissed_at?: string | null
          recovery_dismissed_by?: string | null
          recovery_dismissed_reason?: string | null
          sender_id?: string
          source_bytes?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_vibe_clip_uploads_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_vibe_clip_uploads_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_vibe_clip_uploads_published_message_id_fkey"
            columns: ["published_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      client_feature_flag_history: {
        Row: {
          after_state: Json | null
          before_state: Json | null
          changed_at: string
          changed_by: string | null
          flag_key: string
          id: string
          operation: string
        }
        Insert: {
          after_state?: Json | null
          before_state?: Json | null
          changed_at?: string
          changed_by?: string | null
          flag_key: string
          id?: string
          operation: string
        }
        Update: {
          after_state?: Json | null
          before_state?: Json | null
          changed_at?: string
          changed_by?: string | null
          flag_key?: string
          id?: string
          operation?: string
        }
        Relationships: []
      }
      client_feature_flag_override_history: {
        Row: {
          after_state: Json | null
          before_state: Json | null
          changed_at: string
          changed_by: string | null
          flag_key: string
          id: string
          operation: string
          user_id: string
        }
        Insert: {
          after_state?: Json | null
          before_state?: Json | null
          changed_at?: string
          changed_by?: string | null
          flag_key: string
          id?: string
          operation: string
          user_id: string
        }
        Update: {
          after_state?: Json | null
          before_state?: Json | null
          changed_at?: string
          changed_by?: string | null
          flag_key?: string
          id?: string
          operation?: string
          user_id?: string
        }
        Relationships: []
      }
      client_feature_flag_service_evals: {
        Row: {
          bucket: number | null
          caller_user_id: string | null
          enabled: boolean
          evaluated_at: string
          evaluated_user_id: string | null
          flag_key: string
          id: string
          rollout_bps: number | null
          source: string
        }
        Insert: {
          bucket?: number | null
          caller_user_id?: string | null
          enabled: boolean
          evaluated_at?: string
          evaluated_user_id?: string | null
          flag_key: string
          id?: string
          rollout_bps?: number | null
          source: string
        }
        Update: {
          bucket?: number | null
          caller_user_id?: string | null
          enabled?: boolean
          evaluated_at?: string
          evaluated_user_id?: string | null
          flag_key?: string
          id?: string
          rollout_bps?: number | null
          source?: string
        }
        Relationships: []
      }
      client_feature_flag_user_overrides: {
        Row: {
          created_at: string
          enabled: boolean
          flag_key: string
          reason: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled: boolean
          flag_key: string
          reason?: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          flag_key?: string
          reason?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_feature_flag_user_overrides_flag_key_fkey"
            columns: ["flag_key"]
            isOneToOne: false
            referencedRelation: "client_feature_flags"
            referencedColumns: ["flag_key"]
          },
          {
            foreignKeyName: "client_feature_flag_user_overrides_flag_key_fkey"
            columns: ["flag_key"]
            isOneToOne: false
            referencedRelation: "vw_video_date_flag_rollout"
            referencedColumns: ["flag_key"]
          },
        ]
      }
      client_feature_flags: {
        Row: {
          created_at: string
          description: string
          enabled: boolean
          flag_key: string
          kill_switch_active: boolean
          rollout_bps: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          description?: string
          enabled?: boolean
          flag_key: string
          kill_switch_active?: boolean
          rollout_bps?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          description?: string
          enabled?: boolean
          flag_key?: string
          kill_switch_active?: boolean
          rollout_bps?: number
          updated_at?: string
          updated_by?: string | null
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
          {
            foreignKeyName: "date_feedback_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_session_health"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "date_feedback_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_extension_refund_certification"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "date_feedback_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_provider_room_reconciliation"
            referencedColumns: ["session_id"]
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
          local_timezone: string | null
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
          local_timezone?: string | null
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
          local_timezone?: string | null
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
      event_deck_card_reservations: {
        Row: {
          deck_rank: number
          deck_token: string
          event_id: string
          expires_at: string
          id: string
          issued_at: string
          metadata: Json
          source: string
          swiped_at: string | null
          target_id: string
          viewer_id: string
          visible_at: string | null
        }
        Insert: {
          deck_rank: number
          deck_token: string
          event_id: string
          expires_at: string
          id?: string
          issued_at?: string
          metadata?: Json
          source?: string
          swiped_at?: string | null
          target_id: string
          viewer_id: string
          visible_at?: string | null
        }
        Update: {
          deck_rank?: number
          deck_token?: string
          event_id?: string
          expires_at?: string
          id?: string
          issued_at?: string
          metadata?: Json
          source?: string
          swiped_at?: string | null
          target_id?: string
          viewer_id?: string
          visible_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_deck_card_reservations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_deck_card_reservations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "event_deck_card_reservations_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_deck_card_reservations_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      event_participant_runtime_state: {
        Row: {
          client_platform: string | null
          created_at: string
          device_capabilities: Json
          event_id: string
          foreground: boolean
          last_heartbeat_at: string
          participant_id: string
          readiness_checked_at: string | null
          readiness_status: string
          updated_at: string
        }
        Insert: {
          client_platform?: string | null
          created_at?: string
          device_capabilities?: Json
          event_id: string
          foreground?: boolean
          last_heartbeat_at?: string
          participant_id: string
          readiness_checked_at?: string | null
          readiness_status?: string
          updated_at?: string
        }
        Update: {
          client_platform?: string | null
          created_at?: string
          device_capabilities?: Json
          event_id?: string
          foreground?: boolean
          last_heartbeat_at?: string
          participant_id?: string
          readiness_checked_at?: string | null
          readiness_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_participant_runtime_state_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_participant_runtime_state_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "event_participant_runtime_state_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
            foreignKeyName: "event_payment_exceptions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
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
      event_profile_impression_events: {
        Row: {
          action: string
          created_at: string
          event_id: string
          id: number
          metadata: Json
          session_id: string | null
          source: string
          target_id: string
          viewer_id: string
        }
        Insert: {
          action: string
          created_at?: string
          event_id: string
          id?: number
          metadata?: Json
          session_id?: string | null
          source?: string
          target_id: string
          viewer_id: string
        }
        Update: {
          action?: string
          created_at?: string
          event_id?: string
          id?: number
          metadata?: Json
          session_id?: string | null
          source?: string
          target_id?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_profile_impression_events_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_profile_impression_events_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "event_profile_impression_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "video_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_profile_impression_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_session_health"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "event_profile_impression_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_extension_refund_certification"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "event_profile_impression_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_provider_room_reconciliation"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "event_profile_impression_events_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_profile_impression_events_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_profile_impressions: {
        Row: {
          event_id: string
          first_seen_at: string
          last_action: string
          last_action_at: string
          metadata: Json
          prefetch_expires_at: string | null
          session_id: string | null
          source: string
          strongest_exclusion_reason: string
          target_id: string
          updated_at: string
          viewer_id: string
        }
        Insert: {
          event_id: string
          first_seen_at?: string
          last_action: string
          last_action_at?: string
          metadata?: Json
          prefetch_expires_at?: string | null
          session_id?: string | null
          source?: string
          strongest_exclusion_reason: string
          target_id: string
          updated_at?: string
          viewer_id: string
        }
        Update: {
          event_id?: string
          first_seen_at?: string
          last_action?: string
          last_action_at?: string
          metadata?: Json
          prefetch_expires_at?: string | null
          session_id?: string | null
          source?: string
          strongest_exclusion_reason?: string
          target_id?: string
          updated_at?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_profile_impressions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_profile_impressions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "event_profile_impressions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "video_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_profile_impressions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_session_health"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "event_profile_impressions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_extension_refund_certification"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "event_profile_impressions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_provider_room_reconciliation"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "event_profile_impressions_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_profile_impressions_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          ready_gate_suppressed_session_id: string | null
          ready_gate_suppressed_until: string | null
          registered_at: string
          updated_at: string | null
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
          ready_gate_suppressed_session_id?: string | null
          ready_gate_suppressed_until?: string | null
          registered_at?: string
          updated_at?: string | null
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
          ready_gate_suppressed_session_id?: string | null
          ready_gate_suppressed_until?: string | null
          registered_at?: string
          updated_at?: string | null
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
            foreignKeyName: "event_registrations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
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
          discarded_at: string | null
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
          discarded_at?: string | null
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
          discarded_at?: string | null
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
            foreignKeyName: "event_reminder_queue_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
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
            foreignKeyName: "event_swipes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
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
            foreignKeyName: "event_vibes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
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
          is_test_event: boolean
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
          status: string
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
          is_test_event?: boolean
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
          status?: string
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
          is_test_event?: boolean
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
          status?: string
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
          {
            foreignKeyName: "events_parent_event_id_fkey"
            columns: ["parent_event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
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
          encrypted_conversation_keys: Json | null
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
          encrypted_conversation_keys?: Json | null
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
          encrypted_conversation_keys?: Json | null
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
            foreignKeyName: "matches_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
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
          archive_error: string | null
          archived_at: string | null
          bytes: number | null
          content_sha256: string | null
          created_at: string
          deleted_at: string | null
          derivative_display_path: string | null
          derivative_hero_path: string | null
          derivative_thumb_path: string | null
          dominant_color: string | null
          encryption_metadata: Json | null
          id: string
          last_accessed_at: string | null
          last_error: string | null
          legacy_id: string | null
          legacy_table: string | null
          media_family: string
          mime_type: string | null
          owner_user_id: string | null
          placeholder_hash: string | null
          placeholder_kind: string | null
          placeholder_updated_at: string | null
          provider: string
          provider_object_id: string | null
          provider_path: string | null
          purge_after: string | null
          purged_at: string | null
          status: string
          storage_zone: string
          updated_at: string
        }
        Insert: {
          archive_error?: string | null
          archived_at?: string | null
          bytes?: number | null
          content_sha256?: string | null
          created_at?: string
          deleted_at?: string | null
          derivative_display_path?: string | null
          derivative_hero_path?: string | null
          derivative_thumb_path?: string | null
          dominant_color?: string | null
          encryption_metadata?: Json | null
          id?: string
          last_accessed_at?: string | null
          last_error?: string | null
          legacy_id?: string | null
          legacy_table?: string | null
          media_family: string
          mime_type?: string | null
          owner_user_id?: string | null
          placeholder_hash?: string | null
          placeholder_kind?: string | null
          placeholder_updated_at?: string | null
          provider: string
          provider_object_id?: string | null
          provider_path?: string | null
          purge_after?: string | null
          purged_at?: string | null
          status?: string
          storage_zone?: string
          updated_at?: string
        }
        Update: {
          archive_error?: string | null
          archived_at?: string | null
          bytes?: number | null
          content_sha256?: string | null
          created_at?: string
          deleted_at?: string | null
          derivative_display_path?: string | null
          derivative_hero_path?: string | null
          derivative_thumb_path?: string | null
          dominant_color?: string | null
          encryption_metadata?: Json | null
          id?: string
          last_accessed_at?: string | null
          last_error?: string | null
          legacy_id?: string | null
          legacy_table?: string | null
          media_family?: string
          mime_type?: string | null
          owner_user_id?: string | null
          placeholder_hash?: string | null
          placeholder_kind?: string | null
          placeholder_updated_at?: string | null
          provider?: string
          provider_object_id?: string | null
          provider_path?: string | null
          purge_after?: string | null
          purged_at?: string | null
          status?: string
          storage_zone?: string
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
      media_upload_receipts: {
        Row: {
          asset_id: string | null
          attempt_count: number
          client_request_id: string
          content_sha256: string
          created_at: string
          id: string
          last_error: string | null
          last_failed_at: string | null
          media_family: string
          metadata: Json
          next_retry_at: string | null
          owner_user_id: string
          provider: string
          provider_object_id: string | null
          provider_path: string | null
          scope_key: string
          status: string
          updated_at: string
        }
        Insert: {
          asset_id?: string | null
          attempt_count?: number
          client_request_id: string
          content_sha256: string
          created_at?: string
          id?: string
          last_error?: string | null
          last_failed_at?: string | null
          media_family: string
          metadata?: Json
          next_retry_at?: string | null
          owner_user_id: string
          provider: string
          provider_object_id?: string | null
          provider_path?: string | null
          scope_key?: string
          status?: string
          updated_at?: string
        }
        Update: {
          asset_id?: string | null
          attempt_count?: number
          client_request_id?: string
          content_sha256?: string
          created_at?: string
          id?: string
          last_error?: string | null
          last_failed_at?: string | null
          media_family?: string
          metadata?: Json
          next_retry_at?: string | null
          owner_user_id?: string
          provider?: string
          provider_object_id?: string | null
          provider_path?: string | null
          scope_key?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_upload_receipts_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_upload_receipts_media_family_fkey"
            columns: ["media_family"]
            isOneToOne: false
            referencedRelation: "media_retention_settings"
            referencedColumns: ["media_family"]
          },
        ]
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
      notification_acks: {
        Row: {
          ack_source: string | null
          acked_at: string
          created_at: string
          dispatch_group_id: string
          id: string
          payload: Json
          provider_notification_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ack_source?: string | null
          acked_at?: string
          created_at?: string
          dispatch_group_id: string
          id?: string
          payload?: Json
          provider_notification_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ack_source?: string | null
          acked_at?: string
          created_at?: string
          dispatch_group_id?: string
          id?: string
          payload?: Json
          provider_notification_id?: string | null
          updated_at?: string
          user_id?: string
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
          {
            foreignKeyName: "post_date_client_submissions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_session_health"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "post_date_client_submissions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_extension_refund_certification"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "post_date_client_submissions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_provider_room_reconciliation"
            referencedColumns: ["session_id"]
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
          {
            foreignKeyName: "post_date_pending_verdicts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "vw_session_health"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "post_date_pending_verdicts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "vw_video_date_extension_refund_certification"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "post_date_pending_verdicts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "vw_video_date_provider_room_reconciliation"
            referencedColumns: ["session_id"]
          },
        ]
      }
      post_date_zero_feedback_reminders: {
        Row: {
          completed_at: string | null
          created_at: string
          event_id: string | null
          first_detected_at: string
          last_seen_at: string
          missing_user_id: string
          participant_role: string
          queue_status: string | null
          registration_id: string | null
          reminder_eligible_at: string
          reminder_error: string | null
          reminder_sent_at: string | null
          session_id: string
          stale_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          event_id?: string | null
          first_detected_at?: string
          last_seen_at?: string
          missing_user_id: string
          participant_role: string
          queue_status?: string | null
          registration_id?: string | null
          reminder_eligible_at?: string
          reminder_error?: string | null
          reminder_sent_at?: string | null
          session_id: string
          stale_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          event_id?: string | null
          first_detected_at?: string
          last_seen_at?: string
          missing_user_id?: string
          participant_role?: string
          queue_status?: string | null
          registration_id?: string | null
          reminder_eligible_at?: string
          reminder_error?: string | null
          reminder_sent_at?: string | null
          session_id?: string
          stale_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_date_zero_feedback_reminders_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "video_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_date_zero_feedback_reminders_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_session_health"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "post_date_zero_feedback_reminders_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_extension_refund_certification"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "post_date_zero_feedback_reminders_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_provider_room_reconciliation"
            referencedColumns: ["session_id"]
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
          captions: Json | null
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
          captions?: Json | null
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
          captions?: Json | null
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
          encryption_pub_key: string | null
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
          vibe_video_captions: Json | null
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
          encryption_pub_key?: string | null
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
          vibe_video_captions?: Json | null
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
          encryption_pub_key?: string | null
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
          vibe_video_captions?: Json | null
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
      push_subscriptions: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string
          platform: string
          provider: string
          subscribed: boolean
          subscription_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          provider?: string
          subscribed?: boolean
          subscription_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          provider?: string
          subscribed?: boolean
          subscription_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          entitlement_snapshot: Json
          event_id: string
          event_snapshot: Json
          expected_amount: number
          expected_currency: string
          metadata: Json
          settled_at: string | null
          status: string
          stripe_event_id: string | null
          tier_at_checkout: string | null
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          checkout_session_id: string
          created_at?: string
          entitlement_snapshot?: Json
          event_id: string
          event_snapshot?: Json
          expected_amount: number
          expected_currency: string
          metadata?: Json
          settled_at?: string | null
          status?: string
          stripe_event_id?: string | null
          tier_at_checkout?: string | null
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          checkout_session_id?: string
          created_at?: string
          entitlement_snapshot?: Json
          event_id?: string
          event_snapshot?: Json
          expected_amount?: number
          expected_currency?: string
          metadata?: Json
          settled_at?: string | null
          status?: string
          stripe_event_id?: string | null
          tier_at_checkout?: string | null
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
          {
            foreignKeyName: "stripe_event_ticket_checkout_intents_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
          },
        ]
      }
      stripe_event_ticket_refunds: {
        Row: {
          amount: number | null
          attempts: number
          checkout_session_id: string
          claim_expires_at: string | null
          claimed_by: string | null
          created_at: string
          currency: string | null
          event_id: string
          id: string
          last_error: string | null
          max_attempts: number
          metadata: Json
          next_attempt_at: string
          payment_intent_id: string | null
          profile_id: string
          reason_code: string
          refunded_at: string | null
          settlement_outcome: string | null
          status: string
          stripe_refund_id: string | null
          stripe_refund_status: string | null
          updated_at: string
        }
        Insert: {
          amount?: number | null
          attempts?: number
          checkout_session_id: string
          claim_expires_at?: string | null
          claimed_by?: string | null
          created_at?: string
          currency?: string | null
          event_id: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          metadata?: Json
          next_attempt_at?: string
          payment_intent_id?: string | null
          profile_id: string
          reason_code: string
          refunded_at?: string | null
          settlement_outcome?: string | null
          status?: string
          stripe_refund_id?: string | null
          stripe_refund_status?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number | null
          attempts?: number
          checkout_session_id?: string
          claim_expires_at?: string | null
          claimed_by?: string | null
          created_at?: string
          currency?: string | null
          event_id?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          metadata?: Json
          next_attempt_at?: string
          payment_intent_id?: string | null
          profile_id?: string
          reason_code?: string
          refunded_at?: string | null
          settlement_outcome?: string | null
          status?: string
          stripe_refund_id?: string | null
          stripe_refund_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_event_ticket_refunds_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_event_ticket_refunds_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "stripe_event_ticket_refunds_profile_id_fkey"
            columns: ["profile_id"]
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
          updated_at: string
        }
        Insert: {
          checkout_session_id: string
          created_at?: string
          event_id: string
          outcome: string
          profile_id: string
          result?: Json
          updated_at?: string
        }
        Update: {
          checkout_session_id?: string
          created_at?: string
          event_id?: string
          outcome?: string
          profile_id?: string
          result?: Json
          updated_at?: string
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
            foreignKeyName: "stripe_event_ticket_settlements_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
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
      support_reply_delivery_jobs: {
        Row: {
          attempts: number
          channel: string
          completed_at: string | null
          created_at: string
          error_code: string | null
          id: string
          last_error: string | null
          last_error_at: string | null
          lease_expires_at: string | null
          max_attempts: number
          metadata: Json
          next_retry_at: string
          provider_id: string | null
          recipient_email: string | null
          recipient_user_id: string | null
          reply_id: string
          state: string
          ticket_id: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          attempts?: number
          channel: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          lease_expires_at?: string | null
          max_attempts?: number
          metadata?: Json
          next_retry_at?: string
          provider_id?: string | null
          recipient_email?: string | null
          recipient_user_id?: string | null
          reply_id: string
          state?: string
          ticket_id: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          attempts?: number
          channel?: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          lease_expires_at?: string | null
          max_attempts?: number
          metadata?: Json
          next_retry_at?: string
          provider_id?: string | null
          recipient_email?: string | null
          recipient_user_id?: string | null
          reply_id?: string
          state?: string
          ticket_id?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_reply_delivery_jobs_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_reply_delivery_jobs_reply_id_fkey"
            columns: ["reply_id"]
            isOneToOne: false
            referencedRelation: "support_ticket_replies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_reply_delivery_jobs_ticket_id_fkey"
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
            foreignKeyName: "support_tickets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
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
          flow: string
          id: string
          ip_address: string | null
          user_id: string
        }
        Insert: {
          attempt_at?: string
          flow?: string
          id?: string
          ip_address?: string | null
          user_id: string
        }
        Update: {
          attempt_at?: string
          flow?: string
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
      vibe_video_uploads: {
        Row: {
          aspect_ratio: number | null
          attempt_count: number
          captions: Json | null
          client_request_id: string
          created_at: string
          draft_media_session_id: string | null
          duration_ms: number | null
          error_detail: string | null
          expires_at: string
          id: string
          media_asset_id: string | null
          mime_type: string | null
          provider_object_id: string
          source_bytes: number | null
          status: string
          updated_at: string
          upload_context: string
          user_id: string
        }
        Insert: {
          aspect_ratio?: number | null
          attempt_count?: number
          captions?: Json | null
          client_request_id: string
          created_at?: string
          draft_media_session_id?: string | null
          duration_ms?: number | null
          error_detail?: string | null
          expires_at?: string
          id?: string
          media_asset_id?: string | null
          mime_type?: string | null
          provider_object_id: string
          source_bytes?: number | null
          status?: string
          updated_at?: string
          upload_context?: string
          user_id: string
        }
        Update: {
          aspect_ratio?: number | null
          attempt_count?: number
          captions?: Json | null
          client_request_id?: string
          created_at?: string
          draft_media_session_id?: string | null
          duration_ms?: number | null
          error_detail?: string | null
          expires_at?: string
          id?: string
          media_asset_id?: string | null
          mime_type?: string | null
          provider_object_id?: string
          source_bytes?: number | null
          status?: string
          updated_at?: string
          upload_context?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vibe_video_uploads_draft_media_session_id_fkey"
            columns: ["draft_media_session_id"]
            isOneToOne: false
            referencedRelation: "draft_media_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vibe_video_uploads_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      video_date_certification_feedback_exceptions: {
        Row: {
          created_at: string
          created_by: string | null
          event_id: string | null
          evidence: Json
          exception_kind: string
          expires_at: string | null
          missing_user_id: string
          participant_role: string
          reason: string
          revoked_at: string | null
          revoked_reason: string | null
          session_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_id?: string | null
          evidence?: Json
          exception_kind: string
          expires_at?: string | null
          missing_user_id: string
          participant_role: string
          reason: string
          revoked_at?: string | null
          revoked_reason?: string | null
          session_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_id?: string | null
          evidence?: Json
          exception_kind?: string
          expires_at?: string | null
          missing_user_id?: string
          participant_role?: string
          reason?: string
          revoked_at?: string | null
          revoked_reason?: string | null
          session_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_date_certification_feedback_exceptions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "video_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_date_certification_feedback_exceptions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_session_health"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_date_certification_feedback_exceptions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_extension_refund_certification"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_date_certification_feedback_exceptions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_provider_room_reconciliation"
            referencedColumns: ["session_id"]
          },
        ]
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
            foreignKeyName: "video_date_credit_extension_spends_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_session_health"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_date_credit_extension_spends_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_extension_refund_certification"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_date_credit_extension_spends_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_provider_room_reconciliation"
            referencedColumns: ["session_id"]
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
      video_date_daily_webhook_events: {
        Row: {
          created_at: string
          event_type: string
          id: number
          occurred_at: string
          payload: Json
          processed_at: string | null
          processing_result: string | null
          processing_state: string
          provider_event_id: string
          provider_participant_id: string | null
          provider_user_id: string | null
          room_name: string | null
          session_id: string | null
          signature_timestamp: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: never
          occurred_at?: string
          payload?: Json
          processed_at?: string | null
          processing_result?: string | null
          processing_state?: string
          provider_event_id: string
          provider_participant_id?: string | null
          provider_user_id?: string | null
          room_name?: string | null
          session_id?: string | null
          signature_timestamp?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: never
          occurred_at?: string
          payload?: Json
          processed_at?: string | null
          processing_result?: string | null
          processing_state?: string
          provider_event_id?: string
          provider_participant_id?: string | null
          provider_user_id?: string | null
          room_name?: string | null
          session_id?: string | null
          signature_timestamp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_date_daily_webhook_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "video_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_date_daily_webhook_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_session_health"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_date_daily_webhook_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_extension_refund_certification"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_date_daily_webhook_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_provider_room_reconciliation"
            referencedColumns: ["session_id"]
          },
        ]
      }
      video_date_extension_requests: {
        Row: {
          added_seconds: number
          applied_at: string | null
          applied_by: string | null
          created_at: string
          credit_type: string
          expires_at: string
          failure_reason: string | null
          id: string
          idempotency_key: string
          partner_request_id: string | null
          requester_id: string
          session_id: string
          status: string
          updated_at: string
        }
        Insert: {
          added_seconds: number
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string
          credit_type: string
          expires_at?: string
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          partner_request_id?: string | null
          requester_id: string
          session_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          added_seconds?: number
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string
          credit_type?: string
          expires_at?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          partner_request_id?: string | null
          requester_id?: string
          session_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_date_extension_requests_applied_by_fkey"
            columns: ["applied_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_date_extension_requests_partner_request_id_fkey"
            columns: ["partner_request_id"]
            isOneToOne: false
            referencedRelation: "video_date_extension_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_date_extension_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_date_extension_requests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "video_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_date_extension_requests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_session_health"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_date_extension_requests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_extension_refund_certification"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_date_extension_requests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_provider_room_reconciliation"
            referencedColumns: ["session_id"]
          },
        ]
      }
      video_date_orphan_room_cleanup_audit: {
        Row: {
          action: string
          active_participant_count: number
          created_at: string
          id: number
          metadata: Json
          provider_created_at: string | null
          provider_expires_at: string | null
          provider_room_id: string | null
          reason: string
          room_name: string
          session_id: string | null
        }
        Insert: {
          action: string
          active_participant_count?: number
          created_at?: string
          id?: never
          metadata?: Json
          provider_created_at?: string | null
          provider_expires_at?: string | null
          provider_room_id?: string | null
          reason: string
          room_name: string
          session_id?: string | null
        }
        Update: {
          action?: string
          active_participant_count?: number
          created_at?: string
          id?: never
          metadata?: Json
          provider_created_at?: string | null
          provider_expires_at?: string | null
          provider_room_id?: string | null
          reason?: string
          room_name?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_date_orphan_room_cleanup_audit_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "video_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_date_orphan_room_cleanup_audit_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_session_health"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_date_orphan_room_cleanup_audit_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_extension_refund_certification"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_date_orphan_room_cleanup_audit_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_provider_room_reconciliation"
            referencedColumns: ["session_id"]
          },
        ]
      }
      video_date_phase8_certification_runs: {
        Row: {
          certified_at: string | null
          certified_by: string | null
          commit_sha: string | null
          created_at: string
          event_id: string | null
          expires_at: string | null
          id: string
          notes: string | null
          platform: string
          report: Json
          rollout_bps: number | null
          run_kind: string
          status: string
          updated_at: string
        }
        Insert: {
          certified_at?: string | null
          certified_by?: string | null
          commit_sha?: string | null
          created_at?: string
          event_id?: string | null
          expires_at?: string | null
          id?: string
          notes?: string | null
          platform: string
          report?: Json
          rollout_bps?: number | null
          run_kind: string
          status: string
          updated_at?: string
        }
        Update: {
          certified_at?: string | null
          certified_by?: string | null
          commit_sha?: string | null
          created_at?: string
          event_id?: string | null
          expires_at?: string | null
          id?: string
          notes?: string | null
          platform?: string
          report?: Json
          rollout_bps?: number | null
          run_kind?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_date_phase8_certification_runs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_date_phase8_certification_runs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
          },
        ]
      }
      video_date_presence_events: {
        Row: {
          actor_id: string | null
          call_instance_id: string | null
          created_at: string
          details: Json
          entry_attempt_id: string | null
          event_type: string
          id: string
          occurred_at: string
          owner_id: string | null
          owner_state: string | null
          provider_session_id: string | null
          session_id: string
          source: string
          surface_client_id: string | null
        }
        Insert: {
          actor_id?: string | null
          call_instance_id?: string | null
          created_at?: string
          details?: Json
          entry_attempt_id?: string | null
          event_type: string
          id?: string
          occurred_at?: string
          owner_id?: string | null
          owner_state?: string | null
          provider_session_id?: string | null
          session_id: string
          source: string
          surface_client_id?: string | null
        }
        Update: {
          actor_id?: string | null
          call_instance_id?: string | null
          created_at?: string
          details?: Json
          entry_attempt_id?: string | null
          event_type?: string
          id?: string
          occurred_at?: string
          owner_id?: string | null
          owner_state?: string | null
          provider_session_id?: string | null
          session_id?: string
          source?: string
          surface_client_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_date_presence_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "video_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_date_presence_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_session_health"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_date_presence_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_extension_refund_certification"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_date_presence_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_provider_room_reconciliation"
            referencedColumns: ["session_id"]
          },
        ]
      }
      video_date_provider_dead_letters: {
        Row: {
          created_at: string
          deadline_id: number | null
          id: number
          operation: string | null
          outbox_id: number | null
          payload: Json
          provider: string | null
          reason: string
          session_id: string | null
          target_kind: string
        }
        Insert: {
          created_at?: string
          deadline_id?: number | null
          id?: number
          operation?: string | null
          outbox_id?: number | null
          payload?: Json
          provider?: string | null
          reason: string
          session_id?: string | null
          target_kind: string
        }
        Update: {
          created_at?: string
          deadline_id?: number | null
          id?: number
          operation?: string | null
          outbox_id?: number | null
          payload?: Json
          provider?: string | null
          reason?: string
          session_id?: string | null
          target_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_date_provider_dead_letters_deadline_id_fkey"
            columns: ["deadline_id"]
            isOneToOne: false
            referencedRelation: "video_session_deadlines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_date_provider_dead_letters_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "video_date_provider_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_date_provider_dead_letters_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "video_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_date_provider_dead_letters_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_session_health"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_date_provider_dead_letters_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_extension_refund_certification"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_date_provider_dead_letters_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_provider_room_reconciliation"
            referencedColumns: ["session_id"]
          },
        ]
      }
      video_date_provider_outbox: {
        Row: {
          attempts: number
          claim_expires_at: string | null
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          dedupe_key: string | null
          id: number
          kind: string
          last_error: string | null
          next_attempt_at: string
          payload: Json
          provider_idempotency_key: string
          session_id: string | null
          state: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          claim_expires_at?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: number
          kind: string
          last_error?: string | null
          next_attempt_at?: string
          payload?: Json
          provider_idempotency_key?: string
          session_id?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          claim_expires_at?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: number
          kind?: string
          last_error?: string | null
          next_attempt_at?: string
          payload?: Json
          provider_idempotency_key?: string
          session_id?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_date_provider_outbox_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "video_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_date_provider_outbox_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_session_health"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_date_provider_outbox_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_extension_refund_certification"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_date_provider_outbox_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_provider_room_reconciliation"
            referencedColumns: ["session_id"]
          },
        ]
      }
      video_date_provider_outbox_failure_log: {
        Row: {
          created_at: string
          deadline_id: number | null
          error_code: string | null
          error_message: string | null
          id: number
          lease_lost: boolean
          metadata: Json
          operation: string | null
          outbox_id: number | null
          permanent: boolean
          provider: string | null
          retry_after_seconds: number | null
          session_id: string | null
          target_kind: string
        }
        Insert: {
          created_at?: string
          deadline_id?: number | null
          error_code?: string | null
          error_message?: string | null
          id?: number
          lease_lost?: boolean
          metadata?: Json
          operation?: string | null
          outbox_id?: number | null
          permanent?: boolean
          provider?: string | null
          retry_after_seconds?: number | null
          session_id?: string | null
          target_kind: string
        }
        Update: {
          created_at?: string
          deadline_id?: number | null
          error_code?: string | null
          error_message?: string | null
          id?: number
          lease_lost?: boolean
          metadata?: Json
          operation?: string | null
          outbox_id?: number | null
          permanent?: boolean
          provider?: string | null
          retry_after_seconds?: number | null
          session_id?: string | null
          target_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_date_provider_outbox_failure_log_deadline_id_fkey"
            columns: ["deadline_id"]
            isOneToOne: false
            referencedRelation: "video_session_deadlines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_date_provider_outbox_failure_log_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "video_date_provider_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_date_provider_outbox_failure_log_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "video_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_date_provider_outbox_failure_log_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_session_health"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_date_provider_outbox_failure_log_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_extension_refund_certification"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_date_provider_outbox_failure_log_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_provider_room_reconciliation"
            referencedColumns: ["session_id"]
          },
        ]
      }
      video_date_provider_rate_limits: {
        Row: {
          bucket: string
          capacity: number
          provider: string
          refill_per_second: number
          tokens: number
          updated_at: string
        }
        Insert: {
          bucket: string
          capacity: number
          provider: string
          refill_per_second: number
          tokens?: number
          updated_at?: string
        }
        Update: {
          bucket?: string
          capacity?: number
          provider?: string
          refill_per_second?: number
          tokens?: number
          updated_at?: string
        }
        Relationships: []
      }
      video_date_recovery_alert_dispatches: {
        Row: {
          alert_payload: Json
          created_at: string
          fingerprint: string
          hour_bucket: string
          id: number
          sentry_claimed_at: string | null
          sentry_sent_at: string | null
          severity: string
          slack_claimed_at: string | null
          slack_sent_at: string | null
        }
        Insert: {
          alert_payload?: Json
          created_at?: string
          fingerprint: string
          hour_bucket: string
          id?: number
          sentry_claimed_at?: string | null
          sentry_sent_at?: string | null
          severity: string
          slack_claimed_at?: string | null
          slack_sent_at?: string | null
        }
        Update: {
          alert_payload?: Json
          created_at?: string
          fingerprint?: string
          hour_bucket?: string
          id?: number
          sentry_claimed_at?: string | null
          sentry_sent_at?: string | null
          severity?: string
          slack_claimed_at?: string | null
          slack_sent_at?: string | null
        }
        Relationships: []
      }
      video_date_surface_claim_events: {
        Row: {
          action: string
          actor_id: string | null
          blocked: boolean | null
          client_instance_id: string | null
          created_at: string
          detail: Json
          expires_at: string | null
          id: number
          ok: boolean | null
          released_at: string | null
          result_code: string | null
          retryable: boolean | null
          session_ended_at: string | null
          session_ended_reason: string | null
          session_id: string
          session_state_updated_at: string | null
          session_terminal_generation: number | null
          surface: string
          takeover: boolean
          ttl_seconds: number | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          blocked?: boolean | null
          client_instance_id?: string | null
          created_at?: string
          detail?: Json
          expires_at?: string | null
          id?: number
          ok?: boolean | null
          released_at?: string | null
          result_code?: string | null
          retryable?: boolean | null
          session_ended_at?: string | null
          session_ended_reason?: string | null
          session_id: string
          session_state_updated_at?: string | null
          session_terminal_generation?: number | null
          surface: string
          takeover?: boolean
          ttl_seconds?: number | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          blocked?: boolean | null
          client_instance_id?: string | null
          created_at?: string
          detail?: Json
          expires_at?: string | null
          id?: number
          ok?: boolean | null
          released_at?: string | null
          result_code?: string | null
          retryable?: boolean | null
          session_ended_at?: string | null
          session_ended_reason?: string | null
          session_id?: string
          session_state_updated_at?: string | null
          session_terminal_generation?: number | null
          surface?: string
          takeover?: boolean
          ttl_seconds?: number | null
        }
        Relationships: []
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
          {
            foreignKeyName: "video_date_surface_claims_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_session_health"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_date_surface_claims_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_extension_refund_certification"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_date_surface_claims_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_provider_room_reconciliation"
            referencedColumns: ["session_id"]
          },
        ]
      }
      video_date_webhook_dlq: {
        Row: {
          attempts: number
          created_at: string
          error_class: string
          error_message: string | null
          event_type: string | null
          id: number
          next_retry_at: string | null
          payload_hash: string
          provider: string
          provider_event_id: string | null
          retryable: boolean
          room_name: string | null
          sanitized_payload: Json
          signature_timestamp: string | null
          state: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error_class: string
          error_message?: string | null
          event_type?: string | null
          id?: number
          next_retry_at?: string | null
          payload_hash: string
          provider: string
          provider_event_id?: string | null
          retryable?: boolean
          room_name?: string | null
          sanitized_payload?: Json
          signature_timestamp?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error_class?: string
          error_message?: string | null
          event_type?: string | null
          id?: number
          next_retry_at?: string | null
          payload_hash?: string
          provider?: string
          provider_event_id?: string | null
          retryable?: boolean
          room_name?: string | null
          sanitized_payload?: Json
          signature_timestamp?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      video_date_worker_runs: {
        Row: {
          claim_expires_at: string | null
          claimed_by: string | null
          heartbeat_at: string | null
          metadata: Json
          run_started_at: string | null
          updated_at: string
          worker_kind: string
        }
        Insert: {
          claim_expires_at?: string | null
          claimed_by?: string | null
          heartbeat_at?: string | null
          metadata?: Json
          run_started_at?: string | null
          updated_at?: string
          worker_kind: string
        }
        Update: {
          claim_expires_at?: string | null
          claimed_by?: string | null
          heartbeat_at?: string | null
          metadata?: Json
          run_started_at?: string | null
          updated_at?: string
          worker_kind?: string
        }
        Relationships: []
      }
      video_session_commands: {
        Row: {
          actor: string
          command_kind: string
          committed_at: string | null
          created_at: string
          id: number
          idempotency_key: string
          request_hash: string
          request_payload: Json
          result_payload: Json | null
          session_id: string
          status: string
        }
        Insert: {
          actor: string
          command_kind: string
          committed_at?: string | null
          created_at?: string
          id?: number
          idempotency_key: string
          request_hash: string
          request_payload?: Json
          result_payload?: Json | null
          session_id: string
          status?: string
        }
        Update: {
          actor?: string
          command_kind?: string
          committed_at?: string | null
          created_at?: string
          id?: number
          idempotency_key?: string
          request_hash?: string
          request_payload?: Json
          result_payload?: Json | null
          session_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_session_commands_actor_fkey"
            columns: ["actor"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_session_commands_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "video_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_session_commands_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_session_health"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_session_commands_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_extension_refund_certification"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_session_commands_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_provider_room_reconciliation"
            referencedColumns: ["session_id"]
          },
        ]
      }
      video_session_deadlines: {
        Row: {
          attempts: number
          claim_expires_at: string | null
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          due_at: string
          id: number
          kind: string
          last_error: string | null
          session_id: string
          state: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          claim_expires_at?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          due_at: string
          id?: number
          kind: string
          last_error?: string | null
          session_id: string
          state?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          claim_expires_at?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          due_at?: string
          id?: number
          kind?: string
          last_error?: string | null
          session_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_session_deadlines_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "video_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_session_deadlines_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_session_health"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_session_deadlines_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_extension_refund_certification"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_session_deadlines_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_provider_room_reconciliation"
            referencedColumns: ["session_id"]
          },
        ]
      }
      video_session_events: {
        Row: {
          actor: string | null
          at: string
          correlation_id: string
          id: number
          kind: string
          payload: Json
          sanitized_payload: Json
          session_id: string
          session_seq: number
          visibility: string
        }
        Insert: {
          actor?: string | null
          at?: string
          correlation_id?: string
          id?: number
          kind: string
          payload?: Json
          sanitized_payload?: Json
          session_id: string
          session_seq?: number
          visibility?: string
        }
        Update: {
          actor?: string | null
          at?: string
          correlation_id?: string
          id?: number
          kind?: string
          payload?: Json
          sanitized_payload?: Json
          session_id?: string
          session_seq?: number
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_session_events_actor_fkey"
            columns: ["actor"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_session_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "video_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_session_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_session_health"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_session_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_extension_refund_certification"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_session_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_provider_room_reconciliation"
            referencedColumns: ["session_id"]
          },
        ]
      }
      video_sessions: {
        Row: {
          daily_room_expires_at: string | null
          daily_room_name: string | null
          daily_room_provider_delete_reason: string | null
          daily_room_provider_deleted_at: string | null
          daily_room_provider_verify_reason: string | null
          daily_room_url: string | null
          daily_room_verified_at: string | null
          date_extra_seconds: number
          date_started_at: string | null
          duration_seconds: number | null
          ended_at: string | null
          ended_reason: string | null
          entry_grace_expires_at: string | null
          entry_started_at: string | null
          event_id: string
          id: string
          participant_1_away_at: string | null
          participant_1_decided_at: string | null
          participant_1_id: string
          participant_1_joined_at: string | null
          participant_1_liked: boolean | null
          participant_1_provider_joined_at: string | null
          participant_1_provider_left_at: string | null
          participant_1_remote_seen_at: string | null
          participant_2_away_at: string | null
          participant_2_decided_at: string | null
          participant_2_id: string
          participant_2_joined_at: string | null
          participant_2_liked: boolean | null
          participant_2_provider_joined_at: string | null
          participant_2_provider_left_at: string | null
          participant_2_remote_seen_at: string | null
          phase: string
          prepare_entry_actor_id: string | null
          prepare_entry_attempt_id: string | null
          prepare_entry_expires_at: string | null
          prepare_entry_started_at: string | null
          ready_gate_expires_at: string | null
          ready_gate_status: string
          ready_participant_1_at: string | null
          ready_participant_2_at: string | null
          reconnect_grace_ends_at: string | null
          refund_breakdown: Json | null
          refund_granted_at: string | null
          refund_status: string | null
          session_seq: number
          snooze_expires_at: string | null
          snoozed_by: string | null
          stable_bilateral_media_at: string | null
          stable_bilateral_media_detail: Json
          stable_bilateral_media_source: string | null
          started_at: string
          state: Database["public"]["Enums"]["video_date_state"]
          state_updated_at: string
          terminal_audit_at: string | null
          terminal_audit_detail: Json
          terminal_audit_reason: string | null
          terminal_audit_source: string | null
          terminal_generation: number
          vibe_question_anchor_at: string | null
          vibe_question_index: number
          vibe_questions: Json | null
        }
        Insert: {
          daily_room_expires_at?: string | null
          daily_room_name?: string | null
          daily_room_provider_delete_reason?: string | null
          daily_room_provider_deleted_at?: string | null
          daily_room_provider_verify_reason?: string | null
          daily_room_url?: string | null
          daily_room_verified_at?: string | null
          date_extra_seconds?: number
          date_started_at?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          ended_reason?: string | null
          entry_grace_expires_at?: string | null
          entry_started_at?: string | null
          event_id: string
          id?: string
          participant_1_away_at?: string | null
          participant_1_decided_at?: string | null
          participant_1_id: string
          participant_1_joined_at?: string | null
          participant_1_liked?: boolean | null
          participant_1_provider_joined_at?: string | null
          participant_1_provider_left_at?: string | null
          participant_1_remote_seen_at?: string | null
          participant_2_away_at?: string | null
          participant_2_decided_at?: string | null
          participant_2_id: string
          participant_2_joined_at?: string | null
          participant_2_liked?: boolean | null
          participant_2_provider_joined_at?: string | null
          participant_2_provider_left_at?: string | null
          participant_2_remote_seen_at?: string | null
          phase?: string
          prepare_entry_actor_id?: string | null
          prepare_entry_attempt_id?: string | null
          prepare_entry_expires_at?: string | null
          prepare_entry_started_at?: string | null
          ready_gate_expires_at?: string | null
          ready_gate_status?: string
          ready_participant_1_at?: string | null
          ready_participant_2_at?: string | null
          reconnect_grace_ends_at?: string | null
          refund_breakdown?: Json | null
          refund_granted_at?: string | null
          refund_status?: string | null
          session_seq?: number
          snooze_expires_at?: string | null
          snoozed_by?: string | null
          stable_bilateral_media_at?: string | null
          stable_bilateral_media_detail?: Json
          stable_bilateral_media_source?: string | null
          started_at?: string
          state?: Database["public"]["Enums"]["video_date_state"]
          state_updated_at?: string
          terminal_audit_at?: string | null
          terminal_audit_detail?: Json
          terminal_audit_reason?: string | null
          terminal_audit_source?: string | null
          terminal_generation?: number
          vibe_question_anchor_at?: string | null
          vibe_question_index?: number
          vibe_questions?: Json | null
        }
        Update: {
          daily_room_expires_at?: string | null
          daily_room_name?: string | null
          daily_room_provider_delete_reason?: string | null
          daily_room_provider_deleted_at?: string | null
          daily_room_provider_verify_reason?: string | null
          daily_room_url?: string | null
          daily_room_verified_at?: string | null
          date_extra_seconds?: number
          date_started_at?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          ended_reason?: string | null
          entry_grace_expires_at?: string | null
          entry_started_at?: string | null
          event_id?: string
          id?: string
          participant_1_away_at?: string | null
          participant_1_decided_at?: string | null
          participant_1_id?: string
          participant_1_joined_at?: string | null
          participant_1_liked?: boolean | null
          participant_1_provider_joined_at?: string | null
          participant_1_provider_left_at?: string | null
          participant_1_remote_seen_at?: string | null
          participant_2_away_at?: string | null
          participant_2_decided_at?: string | null
          participant_2_id?: string
          participant_2_joined_at?: string | null
          participant_2_liked?: boolean | null
          participant_2_provider_joined_at?: string | null
          participant_2_provider_left_at?: string | null
          participant_2_remote_seen_at?: string | null
          phase?: string
          prepare_entry_actor_id?: string | null
          prepare_entry_attempt_id?: string | null
          prepare_entry_expires_at?: string | null
          prepare_entry_started_at?: string | null
          ready_gate_expires_at?: string | null
          ready_gate_status?: string
          ready_participant_1_at?: string | null
          ready_participant_2_at?: string | null
          reconnect_grace_ends_at?: string | null
          refund_breakdown?: Json | null
          refund_granted_at?: string | null
          refund_status?: string | null
          session_seq?: number
          snooze_expires_at?: string | null
          snoozed_by?: string | null
          stable_bilateral_media_at?: string | null
          stable_bilateral_media_detail?: Json
          stable_bilateral_media_source?: string | null
          started_at?: string
          state?: Database["public"]["Enums"]["video_date_state"]
          state_updated_at?: string
          terminal_audit_at?: string | null
          terminal_audit_detail?: Json
          terminal_audit_reason?: string | null
          terminal_audit_source?: string | null
          terminal_generation?: number
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
            foreignKeyName: "video_sessions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
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
            foreignKeyName: "waitlist_promotion_notify_queue_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
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
      video_session_participant_events: {
        Row: {
          actor: string | null
          at: string | null
          correlation_id: string | null
          id: number | null
          kind: string | null
          payload: Json | null
          session_id: string | null
          session_seq: number | null
          visibility: string | null
        }
        Insert: {
          actor?: string | null
          at?: string | null
          correlation_id?: string | null
          id?: number | null
          kind?: string | null
          payload?: Json | null
          session_id?: string | null
          session_seq?: number | null
          visibility?: string | null
        }
        Update: {
          actor?: string | null
          at?: string | null
          correlation_id?: string | null
          id?: number | null
          kind?: string | null
          payload?: Json | null
          session_id?: string | null
          session_seq?: number | null
          visibility?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_session_events_actor_fkey"
            columns: ["actor"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_session_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "video_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_session_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_session_health"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_session_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_extension_refund_certification"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "video_session_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "vw_video_date_provider_room_reconciliation"
            referencedColumns: ["session_id"]
          },
        ]
      }
      vw_outbox_health: {
        Row: {
          kind: string | null
          late_rows: number | null
          max_attempts: number | null
          oldest_next_attempt_at: string | null
          row_count: number | null
          state: string | null
        }
        Relationships: []
      }
      vw_session_funnel: {
        Row: {
          active_sessions: number | null
          bucket_utc: string | null
          date_sessions: number | null
          ended_sessions: number | null
          entry_sessions: number | null
          event_id: string | null
          is_test_event: boolean | null
          ready_gate_sessions: number | null
          sample_class: string | null
          sessions_created: number | null
          stuck_over_2m_sessions: number | null
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
            foreignKeyName: "video_sessions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
          },
        ]
      }
      vw_session_health: {
        Row: {
          active_age_seconds: number | null
          active_stuck_over_2m: boolean | null
          daily_room_name: string | null
          date_started_at: string | null
          ended_at: string | null
          ended_reason: string | null
          entry_started_at: string | null
          event_id: string | null
          is_test_event: boolean | null
          last_state_at: string | null
          participant_1_id: string | null
          participant_2_id: string | null
          phase: string | null
          ready_gate_expires_at: string | null
          ready_gate_status: string | null
          sample_class: string | null
          session_id: string | null
          session_seq: number | null
          started_at: string | null
          state: string | null
          state_updated_at: string | null
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
            foreignKeyName: "video_sessions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
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
      vw_synthetic_video_date_health: {
        Row: {
          active_session_count: number | null
          event_date: string | null
          event_id: string | null
          last_session_started_at: string | null
          registration_count: number | null
          session_count: number | null
          status: string | null
          stuck_over_2m_count: number | null
          title: string | null
        }
        Relationships: []
      }
      vw_video_date_daily_performance_emission_health: {
        Row: {
          blocks_rollout_gate: boolean | null
          emission_status: string | null
          event_id: string | null
          failure_count: number | null
          last_sample_at: string | null
          minimum_samples: number | null
          missing_for_rollout_gate: boolean | null
          p95_ms: number | null
          p99_ms: number | null
          sample_count: number | null
          segment_key: string | null
          segment_label: string | null
          success_count: number | null
          window_id: string | null
          window_label: string | null
        }
        Relationships: []
      }
      vw_video_date_daily_performance_samples: {
        Row: {
          actor_id: string | null
          created_at: string | null
          detail: Json | null
          event_id: string | null
          latency_ms: number | null
          outcome: string | null
          platform: string | null
          reason_code: string | null
          segment_key: string | null
          segment_label: string | null
          session_id: string | null
          source_operation: string | null
        }
        Relationships: []
      }
      vw_video_date_daily_performance_segment_health: {
        Row: {
          event_id: string | null
          failure_count: number | null
          last_sample_at: string | null
          max_ms: number | null
          p50_ms: number | null
          p95_ms: number | null
          p95_target_ms: number | null
          p99_ms: number | null
          p99_target_ms: number | null
          platform: string | null
          sample_count: number | null
          segment_key: string | null
          segment_label: string | null
          segment_status: string | null
          success_count: number | null
          window_id: string | null
          window_label: string | null
        }
        Relationships: []
      }
      vw_video_date_daily_pool_decision: {
        Row: {
          decision_reason: string | null
          decision_status: string | null
          event_id: string | null
          extension_refresh_p95_ms: number | null
          extension_refresh_sample_count: number | null
          first_frame_p95_ms: number | null
          first_frame_p99_ms: number | null
          first_frame_sample_count: number | null
          join_p95_ms: number | null
          join_p99_ms: number | null
          join_sample_count: number | null
          reconnect_p95_ms: number | null
          reconnect_sample_count: number | null
          room_p95_ms: number | null
          room_p99_ms: number | null
          room_pool_recommended: boolean | null
          room_sample_count: number | null
          token_p95_ms: number | null
          token_p99_ms: number | null
          token_sample_count: number | null
          window_id: string | null
          window_label: string | null
        }
        Relationships: []
      }
      vw_video_date_extension_mutual_health: {
        Row: {
          applied_requests: number | null
          event_id: string | null
          expired_requests: number | null
          failed_requests: number | null
          insufficient_credit_failures: number | null
          last_applied_at: string | null
          last_request_at: string | null
          pending_requests: number | null
          room_expiry_failures: number | null
          stale_pending_requests: number | null
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
            foreignKeyName: "video_sessions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
          },
        ]
      }
      vw_video_date_extension_refund_certification: {
        Row: {
          ended_reason: string | null
          event_id: string | null
          extended_vibe_spend_count: number | null
          extension_spend_count: number | null
          extra_time_spend_count: number | null
          has_mutual_extension_spend: boolean | null
          refund_breakdown: Json | null
          refund_granted_at: string | null
          refund_status: string | null
          session_id: string | null
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
            foreignKeyName: "video_sessions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
          },
        ]
      }
      vw_video_date_flag_rollout: {
        Row: {
          description: string | null
          enabled: boolean | null
          flag_key: string | null
          kill_switch_active: boolean | null
          rollout_bps: number | null
          updated_at: string | null
        }
        Insert: {
          description?: string | null
          enabled?: boolean | null
          flag_key?: string | null
          kill_switch_active?: boolean | null
          rollout_bps?: number | null
          updated_at?: string | null
        }
        Update: {
          description?: string | null
          enabled?: boolean | null
          flag_key?: string | null
          kill_switch_active?: boolean | null
          rollout_bps?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      vw_video_date_lease_recovery_health: {
        Row: {
          expired_lease_count: number | null
          failed_count: number | null
          high_attempt_count: number | null
          kind: string | null
          late_due_count: number | null
          max_attempts: number | null
          oldest_due_age_seconds: number | null
          oldest_due_at: string | null
          queue_name: string | null
          row_count: number | null
          state: string | null
        }
        Relationships: []
      }
      vw_video_date_legacy_deck_cleanup_readiness: {
        Row: {
          cleanup_readiness_reason: string | null
          current_state_since: string | null
          deck_deal_100pct_active: boolean | null
          deck_deal_100pct_baked: boolean | null
          enabled: boolean | null
          flag_key: string | null
          kill_switch_active: boolean | null
          rollout_bps: number | null
        }
        Relationships: []
      }
      vw_video_date_multi_device_health: {
        Row: {
          active_surface_conflict_count: number | null
          active_surface_conflicts: Json | null
          expired_unreleased_claim_count: number | null
          live_claim_count: number | null
          live_video_date_claim_count: number | null
          observed_at: string | null
        }
        Relationships: []
      }
      vw_video_date_orphan_room_cleanup_health: {
        Row: {
          action: string | null
          bucket_hour: string | null
          destructive_candidate_count: number | null
          failed_count: number | null
          last_seen_at: string | null
          reason: string | null
          row_count: number | null
        }
        Relationships: []
      }
      vw_video_date_phase5_circuit_breaker_decision: {
        Row: {
          current_enabled: boolean | null
          evaluated_at: string | null
          feature_area: string | null
          flag_key: string | null
          kill_switch_active: boolean | null
          observed_count: number | null
          reason: string | null
          should_disable: boolean | null
          trip_threshold: number | null
          window_label: string | null
        }
        Relationships: []
      }
      vw_video_date_phase8_certification_latest: {
        Row: {
          certified_at: string | null
          certified_by: string | null
          commit_sha: string | null
          created_at: string | null
          event_id: string | null
          expires_at: string | null
          id: string | null
          notes: string | null
          platform: string | null
          report: Json | null
          rollout_bps: number | null
          run_kind: string | null
          status: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_date_phase8_certification_runs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_date_phase8_certification_runs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
          },
        ]
      }
      vw_video_date_phase8_release_closure: {
        Row: {
          core_flags_enabled: boolean | null
          core_flags_killed: boolean | null
          core_flags_present: boolean | null
          current_rollout_bps: number | null
          deck_deal_100pct_baked: boolean | null
          generated_at: string | null
          legacy_cleanup_passed: boolean | null
          legacy_deck_cleanup_reason: string | null
          present_flag_count: number | null
          recovery_page_alerts: number | null
          recovery_watch_alerts: number | null
          release_blockers: string[] | null
          release_track: string | null
          required_flag_count: number | null
          rollout_100pct_passed: boolean | null
          rollout_10pct_passed: boolean | null
          rollout_1pct_passed: boolean | null
          rollout_50pct_passed: boolean | null
          stuck_active_sessions_over_2m: number | null
        }
        Relationships: []
      }
      vw_video_date_phase8_rollout_readiness: {
        Row: {
          can_advance_rollout: boolean | null
          chaos_passed: boolean | null
          core_flags_enabled: boolean | null
          core_flags_killed: boolean | null
          core_flags_present: boolean | null
          current_rollout_bps: number | null
          deck_deal_100pct_baked: boolean | null
          event_id: string | null
          first_frame_p95_ms: number | null
          first_frame_p99_ms: number | null
          first_frame_sample_count: number | null
          generated_at: string | null
          legacy_deck_cleanup_reason: string | null
          load_passed: boolean | null
          recovery_page_alerts: number | null
          recovery_watch_alerts: number | null
          rls_negative_passed: boolean | null
          rollout_10pct_passed: boolean | null
          rollout_1pct_passed: boolean | null
          rollout_50pct_passed: boolean | null
          rollout_blockers: string[] | null
          stuck_active_sessions_over_2m: number | null
          target_label: string | null
          target_rollout_bps: number | null
          two_user_native_passed: boolean | null
          two_user_web_passed: boolean | null
          window_id: string | null
          window_label: string | null
        }
        Relationships: []
      }
      vw_video_date_phase8_rollout_step_latest: {
        Row: {
          certified_at: string | null
          certified_by: string | null
          commit_sha: string | null
          created_at: string | null
          event_id: string | null
          expires_at: string | null
          id: string | null
          notes: string | null
          platform: string | null
          report: Json | null
          rollout_bps: number | null
          run_kind: string | null
          status: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_date_phase8_certification_runs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_date_phase8_certification_runs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
          },
        ]
      }
      vw_video_date_provider_room_reconciliation: {
        Row: {
          cleanup_candidate: boolean | null
          daily_room_expires_at: string | null
          daily_room_verified_at: string | null
          ended_at: string | null
          ended_reason: string | null
          event_id: string | null
          has_join_evidence: boolean | null
          is_terminal: boolean | null
          phase: string | null
          room_name: string | null
          room_url: string | null
          session_id: string | null
          session_seq: number | null
          started_at: string | null
          state: Database["public"]["Enums"]["video_date_state"] | null
          terminal_age_seconds: number | null
        }
        Insert: {
          cleanup_candidate?: never
          daily_room_expires_at?: string | null
          daily_room_verified_at?: string | null
          ended_at?: string | null
          ended_reason?: string | null
          event_id?: string | null
          has_join_evidence?: never
          is_terminal?: never
          phase?: string | null
          room_name?: string | null
          room_url?: string | null
          session_id?: string | null
          session_seq?: never
          started_at?: string | null
          state?: Database["public"]["Enums"]["video_date_state"] | null
          terminal_age_seconds?: never
        }
        Update: {
          cleanup_candidate?: never
          daily_room_expires_at?: string | null
          daily_room_verified_at?: string | null
          ended_at?: string | null
          ended_reason?: string | null
          event_id?: string | null
          has_join_evidence?: never
          is_terminal?: never
          phase?: string | null
          room_name?: string | null
          room_url?: string | null
          session_id?: string | null
          session_seq?: never
          started_at?: string | null
          state?: Database["public"]["Enums"]["video_date_state"] | null
          terminal_age_seconds?: never
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
            foreignKeyName: "video_sessions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "vw_synthetic_video_date_health"
            referencedColumns: ["event_id"]
          },
        ]
      }
      vw_video_date_recovery_alerts: {
        Row: {
          details: Json | null
          generated_at: string | null
          kind: string | null
          queue_name: string | null
          severity: string | null
          state: string | null
        }
        Relationships: []
      }
      vw_video_date_v4_schema_inventory: {
        Row: {
          object_kind: string | null
          object_name: string | null
          present: boolean | null
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
      _date_suggestion_blocks_new_proposal: {
        Args: {
          p_expires_at: string
          p_local_timezone: string
          p_now?: string
          p_revision_created_at: string
          p_schedule_share_enabled: boolean
          p_schedule_share_expires_at: string
          p_starts_at: string
          p_status: string
          p_suggestion_created_at: string
          p_time_choice_key: string
        }
        Returns: boolean
      }
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
      _date_suggestion_normalize_timezone: {
        Args: { p_timezone: string }
        Returns: string
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
      _date_suggestion_window_end: {
        Args: {
          p_anchor_at: string
          p_expires_at: string
          p_local_timezone: string
          p_schedule_share_enabled: boolean
          p_schedule_share_expires_at: string
          p_starts_at: string
          p_time_choice_key: string
        }
        Returns: string
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
      ack_notification_dispatch: {
        Args: {
          p_ack_source?: string
          p_dispatch_group_id: string
          p_payload?: Json
          p_provider_notification_id?: string
        }
        Returns: Json
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
        Args: {
          p_active?: boolean
          p_emoji: string
          p_label: string
          p_sort_order?: number
        }
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
          p_send_email?: boolean
          p_ticket_id: string
        }
        Returns: Json
      }
      admin_delete_client_feature_flag_override: {
        Args: { p_flag: string; p_reason: string; p_user_id: string }
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
      admin_get_admin_durable_job_health: { Args: never; Returns: Json }
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
          p_offset?: number
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
      admin_list_client_feature_flag_overrides: {
        Args: { p_flag?: string; p_limit?: number; p_search?: string }
        Returns: Json
      }
      admin_list_client_feature_flags: { Args: never; Returns: Json }
      admin_list_data_export_jobs: {
        Args: { p_filters?: Json; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      admin_list_event_analytics_options: {
        Args: { p_include_archived?: boolean; p_limit?: number }
        Returns: Json
      }
      admin_list_event_attendees: {
        Args: { p_event_id: string; p_search?: string }
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
      admin_list_push_notification_events: {
        Args: { p_limit?: number }
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
      admin_publish_event: {
        Args: {
          p_event_id: string
          p_idempotency_key?: string
          p_reason?: string
        }
        Returns: Json
      }
      admin_publish_event_series: {
        Args: {
          p_idempotency_key?: string
          p_parent_event_id: string
          p_reason?: string
        }
        Returns: Json
      }
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
      admin_retry_account_deletion_completion_job: {
        Args: {
          p_idempotency_key?: string
          p_job_id: string
          p_reason?: string
        }
        Returns: Json
      }
      admin_retry_support_reply_delivery_job: {
        Args: {
          p_idempotency_key?: string
          p_job_id: string
          p_reason?: string
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
          p_include_meta?: boolean
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
      admin_unpublish_event: {
        Args: {
          p_event_id: string
          p_idempotency_key?: string
          p_reason?: string
        }
        Returns: Json
      }
      admin_unpublish_event_series: {
        Args: {
          p_idempotency_key?: string
          p_parent_event_id: string
          p_reason?: string
        }
        Returns: Json
      }
      admin_update_client_feature_flag: {
        Args: {
          p_description: string
          p_enabled: boolean
          p_flag: string
          p_kill_switch_active: boolean
          p_reason: string
          p_rollout_bps: number
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
      admin_upsert_client_feature_flag_override: {
        Args: {
          p_enabled: boolean
          p_flag: string
          p_reason: string
          p_user_id: string
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
      append_video_session_event_v2: {
        Args: {
          p_actor?: string
          p_bump_seq?: boolean
          p_correlation_id?: string
          p_kind: string
          p_payload?: Json
          p_sanitized_payload?: Json
          p_session_id: string
          p_visibility?: string
        }
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
      apply_video_date_circuit_breaker_v1: {
        Args: { p_dry_run?: boolean; p_reason?: string }
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
      attach_media_reference: {
        Args: {
          p_asset_id: string
          p_ref_id: string
          p_ref_key?: string
          p_ref_table: string
          p_ref_type: string
        }
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
      begin_video_date_worker_run_v1: {
        Args: {
          p_lease_seconds?: number
          p_metadata?: Json
          p_worker_id: string
          p_worker_kind: string
        }
        Returns: Json
      }
      block_user_with_cleanup: {
        Args: { p_blocked_id: string; p_match_id?: string; p_reason?: string }
        Returns: Json
      }
      bump_video_session_seq: {
        Args: { p_session_id: string }
        Returns: number
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
      claim_account_deletion_completion_jobs_v1: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_worker_id: string
        }
        Returns: {
          attempts: number
          auth_delete_completed_at: string | null
          blocked_reason: string | null
          completed_at: string | null
          created_at: string
          deletion_request_id: string
          error_code: string | null
          id: string
          last_error: string | null
          last_error_at: string | null
          lease_expires_at: string | null
          legacy_checkpoint: boolean
          max_attempts: number
          media_cleanup_completed_at: string | null
          metadata: Json
          next_retry_at: string
          pii_scrub_completed_at: string | null
          provider_cleanup_completed_at: string | null
          provider_cleanup_provider_id: string | null
          request_reason: string | null
          requested_by: string | null
          state: string
          updated_at: string
          user_id: string
          worker_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "account_deletion_completion_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
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
      claim_event_ticket_refund_jobs_v1: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_worker_id: string
        }
        Returns: {
          amount: number
          attempts: number
          checkout_session_id: string
          currency: string
          event_id: string
          id: string
          max_attempts: number
          metadata: Json
          payment_intent_id: string
          profile_id: string
          reason_code: string
          settlement_outcome: string
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
      claim_post_date_zero_feedback_reminders_v1: {
        Args: { p_limit?: number }
        Returns: {
          event_id: string
          first_detected_at: string
          missing_user_id: string
          participant_role: string
          reminder_sent_at: string
          session_id: string
        }[]
      }
      claim_support_reply_delivery_jobs_v1: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_worker_id: string
        }
        Returns: {
          attempts: number
          channel: string
          completed_at: string | null
          created_at: string
          error_code: string | null
          id: string
          last_error: string | null
          last_error_at: string | null
          lease_expires_at: string | null
          max_attempts: number
          metadata: Json
          next_retry_at: string
          provider_id: string | null
          recipient_email: string | null
          recipient_user_id: string | null
          reply_id: string
          state: string
          ticket_id: string
          updated_at: string
          worker_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "support_reply_delivery_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_video_date_provider_outbox_v2: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_worker_id: string
        }
        Returns: {
          attempts: number
          claim_expires_at: string
          dedupe_key: string
          id: number
          kind: string
          payload: Json
          provider_idempotency_key: string
          session_id: string
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
      claim_video_session_deadlines_v2: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_worker_id: string
        }
        Returns: {
          attempts: number
          claim_expires_at: string
          due_at: string
          id: number
          kind: string
          session_id: string
        }[]
      }
      classify_stale_vibe_video_uploads: {
        Args: { p_limit?: number; p_stale_minutes?: number }
        Returns: Json
      }
      cleanup_event_deck_card_reservations: {
        Args: { p_limit?: number; p_older_than?: string }
        Returns: number
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
      client_feature_flag_bucket: {
        Args: { p_flag: string; p_user: string }
        Returns: number
      }
      client_feature_flag_user_bucket: {
        Args: { p_user: string }
        Returns: string
      }
      complete_account_deletion_completion_step_v1: {
        Args: {
          p_details?: Json
          p_job_id: string
          p_provider_id?: string
          p_step: string
          p_worker_id: string
        }
        Returns: Json
      }
      complete_account_deletion_media_cleanup: {
        Args: { p_user_id: string }
        Returns: Json
      }
      complete_event_ticket_refund_job_v1: {
        Args: {
          p_error?: string
          p_job_id: string
          p_noop_already_refunded?: boolean
          p_permanent?: boolean
          p_provider_refund_id?: string
          p_provider_refund_status?: string
          p_retry_after_seconds?: number
          p_success: boolean
          p_worker_id: string
        }
        Returns: Json
      }
      complete_media_delete_job: {
        Args: { p_error?: string; p_job_id: string; p_success: boolean }
        Returns: Json
      }
      complete_onboarding: { Args: { p_user_id: string }; Returns: Json }
      complete_profile_photo_media_upload: {
        Args: {
          p_bytes?: number
          p_content_sha256?: string
          p_context: string
          p_metadata?: Json
          p_mime_type?: string
          p_owner_user_id: string
          p_provider: string
          p_provider_path: string
          p_receipt_id: string
        }
        Returns: Json
      }
      complete_storage_media_upload: {
        Args: {
          p_bytes?: number
          p_content_sha256?: string
          p_last_error?: string
          p_legacy_id?: string
          p_legacy_table?: string
          p_media_family: string
          p_metadata?: Json
          p_mime_type?: string
          p_owner_user_id: string
          p_provider: string
          p_provider_object_id?: string
          p_provider_path?: string
          p_receipt_id: string
          p_receipt_status?: string
          p_reference_id?: string
        }
        Returns: Json
      }
      complete_support_reply_delivery_job_v1: {
        Args: {
          p_blocked?: boolean
          p_error?: string
          p_error_code?: string
          p_job_id: string
          p_permanent?: boolean
          p_provider_id?: string
          p_retry_after_seconds?: number
          p_success: boolean
          p_worker_id: string
        }
        Returns: Json
      }
      complete_video_date_provider_outbox_v2: {
        Args: {
          p_error?: string
          p_outbox_id: number
          p_permanent?: boolean
          p_retry_after_seconds?: number
          p_success: boolean
          p_worker_id: string
        }
        Returns: Json
      }
      complete_video_session_deadline_v2: {
        Args: {
          p_deadline_id: number
          p_error?: string
          p_permanent?: boolean
          p_retry_after_seconds?: number
          p_success: boolean
          p_worker_id: string
        }
        Returns: Json
      }
      confirm_vde_event_inactive_base_v1: {
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
      date_suggestion_apply_v2_stale_window_dispatch_20260517: {
        Args: { p_action: string; p_payload: Json }
        Returns: Json
      }
      date_suggestion_expire_stale_open_suggestions: {
        Args: { p_match_id?: string; p_now?: string }
        Returns: number
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
      end_unconfirmed_video_date_start: {
        Args: {
          p_actor?: string
          p_reason?: string
          p_session_id: string
          p_source?: string
        }
        Returns: Json
      }
      enqueue_due_account_deletion_completion_jobs_v1: {
        Args: { p_limit?: number }
        Returns: number
      }
      enqueue_event_ticket_refund_v1: {
        Args: {
          p_amount?: number
          p_checkout_session_id: string
          p_currency?: string
          p_event_id: string
          p_metadata?: Json
          p_payment_intent_id?: string
          p_profile_id: string
          p_reason_code?: string
          p_settlement_outcome?: string
          p_stripe_event_id?: string
        }
        Returns: Json
      }
      enqueue_media_delete: {
        Args: { p_asset_id: string; p_job_type?: string }
        Returns: Json
      }
      enqueue_uploaded_media_orphan_delete_rows: {
        Args: { p_family_filter?: string; p_limit?: number }
        Returns: {
          asset_id: string
          job_id: string
          media_family: string
          provider: string
          provider_object_id: string
          provider_path: string
        }[]
      }
      enqueue_uploaded_media_orphan_deletes: {
        Args: { p_family_filter?: string; p_limit?: number }
        Returns: number
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
      ensure_event_ticket_refund_support_exception_v1: {
        Args: {
          p_checkout_session_id: string
          p_event_id: string
          p_exception_status?: string
          p_exception_type?: string
          p_notes?: string
          p_profile_id: string
          p_settlement_outcome?: string
        }
        Returns: string
      }
      ensure_profile_from_auth_user: { Args: never; Returns: boolean }
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
      evaluate_all_client_feature_flags: {
        Args: { p_user?: string }
        Returns: Json
      }
      evaluate_client_feature_flag: {
        Args: { p_flag: string; p_user?: string }
        Returns: boolean
      }
      evaluate_client_feature_flag_detail: {
        Args: { p_flag: string; p_user?: string }
        Returns: Json
      }
      evaluate_client_feature_flags: {
        Args: { p_flag_keys: string[]; p_user?: string }
        Returns: Json
      }
      event_category_keys_are_valid: {
        Args: { p_keys: string[] }
        Returns: boolean
      }
      event_category_slug: { Args: { p_label: string }; Returns: string }
      event_deck_candidate_eligibility: {
        Args: {
          p_check_active?: boolean
          p_check_existing_swipe?: boolean
          p_event_id: string
          p_target_id: string
          p_viewer_id: string
        }
        Returns: Json
      }
      event_deck_current_top_candidate: {
        Args: { p_event_id: string; p_viewer_id: string }
        Returns: string
      }
      event_deck_swipe_failure_response: {
        Args: { p_validation: Json }
        Returns: Json
      }
      event_deck_validate_presented_card: {
        Args: {
          p_deck_token?: string
          p_event_id: string
          p_target_id: string
          p_viewer_id: string
        }
        Returns: Json
      }
      event_lobby_video_session_blocks_new_match: {
        Args: {
          p_date_started_at: string
          p_ended_at: string
          p_entry_started_at: string
          p_phase: string
          p_ready_gate_status: string
          p_state: string
        }
        Returns: boolean
      }
      expire_due_joined_video_date_entries_bounded: {
        Args: { p_limit?: number }
        Returns: Json
      }
      expire_pending_daily_drops: { Args: never; Returns: Json }
      expire_stale_video_date_partial_joins_bounded: {
        Args: { p_limit?: number }
        Returns: Json
      }
      expire_stale_video_date_phases_bounded: {
        Args: { p_limit?: number }
        Returns: Json
      }
      expire_stale_video_sessions: { Args: never; Returns: number }
      expire_video_date_reconnect_graces: { Args: never; Returns: number }
      extract_chat_image_path_from_content: {
        Args: { p_content: string }
        Returns: string
      }
      fail_account_deletion_completion_job_v1: {
        Args: {
          p_blocked?: boolean
          p_error: string
          p_error_code?: string
          p_job_id: string
          p_permanent?: boolean
          p_retry_after_seconds?: number
          p_worker_id: string
        }
        Returns: Json
      }
      finalize_due_events: {
        Args: { p_limit?: number; p_now?: string }
        Returns: Json
      }
      finalize_onboarding: {
        Args: { p_final_data?: Json; p_user_id: string }
        Returns: Json
      }
      finalize_video_date_entry_deadline: {
        Args: {
          p_actor?: string
          p_reason?: string
          p_session_id: string
          p_source?: string
        }
        Returns: Json
      }
      finalize_video_session_deadline_v2: {
        Args: { p_deadline_id: number; p_worker_id: string }
        Returns: Json
      }
      finish_video_date_worker_run_v1: {
        Args: { p_metadata?: Json; p_worker_id: string; p_worker_kind: string }
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
      get_dashboard_visible_matches: {
        Args: { p_limit?: number }
        Returns: {
          id: string
          matched_at: string
          profile_id_1: string
          profile_id_2: string
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
          media_version: string
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
      get_event_deck_v2: {
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
      get_event_deck_v3: {
        Args: { p_event_id: string; p_limit?: number; p_user_id: string }
        Returns: Json
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
      get_event_ticket_payment_status_v1: {
        Args: { p_event_id: string }
        Returns: Json
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
      get_media_upload_receipt_status: {
        Args: {
          p_client_request_id: string
          p_media_family: string
          p_scope_key: string
        }
        Returns: Json
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
      get_my_profile_settings: { Args: never; Returns: Json }
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
      get_profile_for_viewer_20260603150106_start_base: {
        Args: { p_target_id: string }
        Returns: Json
      }
      get_profile_presence_for_viewer: {
        Args: { p_event_id?: string; p_target_user_id: string }
        Returns: {
          can_view_presence: boolean
          is_online: boolean
          last_seen_at: string
          target_user_id: string
        }[]
      }
      get_profiles_for_viewer: {
        Args: { p_target_ids: string[] }
        Returns: Json
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
      get_video_date_circuit_breaker_decision_v1: {
        Args: never
        Returns: {
          current_enabled: boolean
          evaluated_at: string
          feature_area: string
          flag_key: string
          kill_switch_active: boolean
          observed_count: number
          reason: string
          should_disable: boolean
          trip_threshold: number
          window_label: string
        }[]
      }
      get_video_date_daily_performance_decision: {
        Args: { p_event_id?: string }
        Returns: {
          decision_reason: string
          decision_status: string
          event_id: string
          extension_refresh_p95_ms: number
          extension_refresh_sample_count: number
          first_frame_p95_ms: number
          first_frame_p99_ms: number
          first_frame_sample_count: number
          join_p95_ms: number
          join_p99_ms: number
          join_sample_count: number
          reconnect_p95_ms: number
          reconnect_sample_count: number
          room_p95_ms: number
          room_p99_ms: number
          room_pool_recommended: boolean
          room_sample_count: number
          token_p95_ms: number
          token_p99_ms: number
          token_sample_count: number
          window_id: string
          window_label: string
        }[]
      }
      get_video_date_daily_performance_emission_health: {
        Args: { p_event_id?: string }
        Returns: {
          blocks_rollout_gate: boolean
          emission_status: string
          event_id: string
          failure_count: number
          last_sample_at: string
          minimum_samples: number
          missing_for_rollout_gate: boolean
          p95_ms: number
          p99_ms: number
          sample_count: number
          segment_key: string
          segment_label: string
          success_count: number
          window_id: string
          window_label: string
        }[]
      }
      get_video_date_phase2_recovery_health: { Args: never; Returns: Json }
      get_video_date_phase8_release_closure: {
        Args: never
        Returns: {
          can_close_phase8: boolean
          core_flags_enabled: boolean
          core_flags_killed: boolean
          core_flags_present: boolean
          current_rollout_bps: number
          deck_deal_100pct_baked: boolean
          generated_at: string
          legacy_cleanup_passed: boolean
          legacy_deck_cleanup_reason: string
          recovery_page_alerts: number
          recovery_watch_alerts: number
          release_blockers: string[]
          release_track: string
          rollout_100pct_passed: boolean
          rollout_10pct_passed: boolean
          rollout_1pct_passed: boolean
          rollout_50pct_passed: boolean
          stuck_active_sessions_over_2m: number
        }[]
      }
      get_video_date_phase8_rollout_readiness: {
        Args: { p_event_id?: string }
        Returns: {
          can_advance_rollout: boolean
          chaos_passed: boolean
          core_flags_enabled: boolean
          core_flags_killed: boolean
          core_flags_present: boolean
          current_rollout_bps: number
          deck_deal_100pct_baked: boolean
          event_id: string
          first_frame_p95_ms: number
          first_frame_p99_ms: number
          first_frame_sample_count: number
          generated_at: string
          legacy_deck_cleanup_reason: string
          load_passed: boolean
          recovery_page_alerts: number
          recovery_watch_alerts: number
          rls_negative_passed: boolean
          rollout_10pct_passed: boolean
          rollout_1pct_passed: boolean
          rollout_50pct_passed: boolean
          rollout_blockers: string[]
          stuck_active_sessions_over_2m: number
          target_label: string
          target_rollout_bps: number
          two_user_native_passed: boolean
          two_user_web_passed: boolean
          window_id: string
          window_label: string
        }[]
      }
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
      get_video_date_snapshot_core: {
        Args: { p_session_id: string }
        Returns: Json
      }
      get_video_date_sprint7_ops_health: {
        Args: { p_event_id?: string }
        Returns: Json
      }
      get_video_date_start_snapshot_v1: {
        Args: { p_session_id: string }
        Returns: Json
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
      handle_swipe_20260601183000_deck_authority_base: {
        Args: {
          p_actor_id: string
          p_event_id: string
          p_swipe_type: string
          p_target_id: string
        }
        Returns: Json
      }
      handle_swipe_20260607103000_mutual_match_source_base: {
        Args: {
          p_actor_id: string
          p_event_id: string
          p_swipe_type: string
          p_target_id: string
        }
        Returns: Json
      }
      handle_swipe_20260610000100_auto_next_base: {
        Args: {
          p_actor_id: string
          p_event_id: string
          p_swipe_type: string
          p_target_id: string
        }
        Returns: Json
      }
      handle_swipe_v2: {
        Args: {
          p_actor_id: string
          p_deck_token?: string
          p_event_id: string
          p_swipe_type: string
          p_target_id: string
        }
        Returns: Json
      }
      handle_swipe_v2_20260607103000_actor_bound_base: {
        Args: {
          p_actor_id: string
          p_deck_token?: string
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
      increment_vibe_video_upload_attempt_count: {
        Args: { p_upload_id: string }
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
      mark_media_asset_accessed: {
        Args: { p_asset_id: string }
        Returns: undefined
      }
      mark_media_asset_soft_deleted_if_unreferenced: {
        Args: { p_asset_id: string; p_deleted_at?: string }
        Returns: Json
      }
      mark_media_upload_receipt_failed: {
        Args: {
          p_last_error: string
          p_metadata?: Json
          p_owner_user_id: string
          p_receipt_id: string
        }
        Returns: Json
      }
      mark_my_activity_seen: { Args: never; Returns: boolean }
      mark_notification_opened: {
        Args: { notification_id: string }
        Returns: boolean
      }
      mark_notification_opened_v2: {
        Args: { notification_id: string }
        Returns: Json
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
      mark_post_date_zero_feedback_reminders_stale_v1: {
        Args: { p_limit?: number; p_older_than?: string }
        Returns: number
      }
      mark_profile_email_verified_from_server: {
        Args: { p_user_id: string; p_verified_email: string }
        Returns: undefined
      }
      mark_profile_phone_verified_from_server: {
        Args: {
          p_phone_number: string
          p_user_id: string
          p_verified_at?: string
        }
        Returns: undefined
      }
      mark_stale_vibe_video_uploads_failed: {
        Args: { p_limit?: number; p_stale_minutes?: number }
        Returns: Json
      }
      mark_support_reply_read: {
        Args: { p_reply_id: string }
        Returns: undefined
      }
      mark_video_date_daily_alive: {
        Args: {
          p_call_instance_id?: string
          p_entry_attempt_id?: string
          p_owner_id?: string
          p_owner_state?: string
          p_provider_session_id?: string
          p_session_id: string
        }
        Returns: Json
      }
      mark_video_date_daily_joined: {
        Args: {
          p_call_instance_id?: string
          p_entry_attempt_id?: string
          p_owner_id?: string
          p_owner_state?: string
          p_provider_session_id?: string
          p_session_id: string
        }
        Returns: Json
      }
      mark_video_date_remote_seen: {
        Args: {
          p_call_instance_id?: string
          p_entry_attempt_id?: string
          p_evidence_source?: string
          p_owner_id?: string
          p_owner_state?: string
          p_provider_session_id?: string
          p_session_id: string
        }
        Returns: Json
      }
      media_asset_can_access_user_topic: {
        Args: { p_topic: string }
        Returns: boolean
      }
      media_asset_realtime_topic_is_user: {
        Args: { p_topic: string }
        Returns: boolean
      }
      media_captions_jsonb_valid: {
        Args: { p_captions: Json }
        Returns: boolean
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
      normalize_onesignal_push_platform: {
        Args: { p_platform: string }
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
      persist_ready_gate_suppression_v2: {
        Args: { p_session_id: string; p_suppressed_until?: string }
        Returns: Json
      }
      preference_allows_gender: {
        Args: { p_gender: string; p_interested_in: string[] }
        Returns: boolean
      }
      preview_media_delete_worker_run: {
        Args: { p_family_filter?: string; p_limit?: number }
        Returns: Json
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
      profile_photo_derivatives_for_paths: {
        Args: { p_owner_user_id: string; p_photo_paths: string[] }
        Returns: Json
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
      purge_old_admin_session_invalidation_events: {
        Args: { p_limit?: number; p_retention_days?: number }
        Returns: number
      }
      ready_gate_transition: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      recompute_profile_live_counts: {
        Args: { p_profile_id: string }
        Returns: undefined
      }
      recompute_profile_subscription_entitlement: {
        Args: { p_user_id: string }
        Returns: Json
      }
      record_deck_deal_v2: {
        Args: { p_event_id: string; p_source?: string; p_target_id: string }
        Returns: Json
      }
      record_event_deck_card_visible_v1:
        | {
            Args: {
              p_event_id: string
              p_target_id: string
              p_viewer_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_deck_token?: string
              p_event_id: string
              p_target_id: string
              p_viewer_id: string
            }
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
      record_event_profile_impression_v2: {
        Args: {
          p_action: string
          p_event_id: string
          p_metadata?: Json
          p_session_id?: string
          p_source?: string
          p_target_id: string
          p_viewer_id: string
        }
        Returns: Json
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
      record_heartbeat_v2: {
        Args: {
          p_client_platform?: string
          p_event_id: string
          p_foreground?: boolean
        }
        Returns: Json
      }
      record_post_date_pending_verdict_reminder_result: {
        Args: { p_error?: string; p_session_id: string; p_success: boolean }
        Returns: Json
      }
      record_post_date_zero_feedback_reminder_result_v1: {
        Args: {
          p_error?: string
          p_missing_user_id: string
          p_session_id: string
          p_success: boolean
        }
        Returns: undefined
      }
      record_public_account_deletion_request: {
        Args: { p_email_hash: string; p_ip_hash: string }
        Returns: Json
      }
      record_readiness_check_v2: {
        Args: {
          p_capabilities?: Json
          p_client_platform?: string
          p_event_id: string
          p_status: string
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
      record_video_date_daily_webhook_event_v2: {
        Args: {
          p_event_type: string
          p_occurred_at?: string
          p_payload?: Json
          p_provider_event_id: string
          p_provider_participant_id?: string
          p_provider_user_id?: string
          p_room_name?: string
          p_signature_timestamp?: string
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
      record_video_date_launch_latency_checkpoints_v1: {
        Args: { p_checkpoints?: Json; p_session_id: string }
        Returns: Json
      }
      record_video_date_orphan_room_cleanup_audit_v2: {
        Args: {
          p_action: string
          p_active_participant_count?: number
          p_metadata?: Json
          p_provider_created_at?: string
          p_provider_expires_at?: string
          p_provider_room_id?: string
          p_reason: string
          p_room_name: string
          p_session_id?: string
        }
        Returns: Json
      }
      record_video_date_phase8_certification_run_v2: {
        Args: {
          p_commit_sha?: string
          p_event_id?: string
          p_expires_at?: string
          p_notes?: string
          p_platform: string
          p_report?: Json
          p_rollout_bps?: number
          p_run_kind: string
          p_status: string
        }
        Returns: Json
      }
      record_video_date_phase8_legacy_cleanup_v2: {
        Args: {
          p_commit_sha?: string
          p_expires_at?: string
          p_notes?: string
          p_report?: Json
        }
        Returns: Json
      }
      record_video_date_phase8_rollout_step_v2: {
        Args: {
          p_commit_sha?: string
          p_event_id: string
          p_expires_at?: string
          p_notes?: string
          p_report?: Json
          p_rollout_bps: number
        }
        Returns: Json
      }
      record_video_date_webhook_dlq_v1: {
        Args: {
          p_error_class?: string
          p_error_message?: string
          p_event_type?: string
          p_payload_hash?: string
          p_provider: string
          p_provider_event_id?: string
          p_retryable?: boolean
          p_room_name?: string
          p_sanitized_payload?: Json
          p_signature_timestamp?: string
        }
        Returns: Json
      }
      recover_ready_gate_missing_rooms_v1: {
        Args: {
          p_grace_seconds?: number
          p_limit?: number
          p_terminal_after_seconds?: number
        }
        Returns: Json
      }
      refresh_my_vibe_score: { Args: never; Returns: Json }
      refresh_video_date_provider_outbox_claim_v1: {
        Args: {
          p_lease_seconds?: number
          p_outbox_id: number
          p_worker_id: string
        }
        Returns: Json
      }
      refresh_video_date_worker_run_v1: {
        Args: {
          p_lease_seconds?: number
          p_metadata?: Json
          p_worker_id: string
          p_worker_kind: string
        }
        Returns: Json
      }
      refresh_video_session_deadline_claim_v1: {
        Args: {
          p_deadline_id: number
          p_lease_seconds?: number
          p_worker_id: string
        }
        Returns: Json
      }
      refund_failed_video_date: {
        Args: { p_session_id: string }
        Returns: Json
      }
      register_for_event: { Args: { p_event_id: string }; Returns: Json }
      register_for_event_20260601143000_terminal_base: {
        Args: { p_event_id: string }
        Returns: Json
      }
      register_onesignal_push_subscription: {
        Args: {
          p_expected_user_id?: string
          p_platform?: string
          p_subscribed?: boolean
          p_subscription_id: string
        }
        Returns: undefined
      }
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
      repair_video_date_registration_session_drift_v1: {
        Args: { p_dry_run?: boolean; p_event_id?: string; p_limit?: number }
        Returns: Json
      }
      replace_event_cover_media_reference: {
        Args: {
          p_asset_id: string
          p_event_id: string
          p_expected_current_asset_id?: string
        }
        Returns: Json
      }
      replenish_monthly_credits: { Args: never; Returns: Json }
      requeue_stale_media_delete_jobs: {
        Args: { p_stale_minutes?: number }
        Returns: number
      }
      reserve_media_upload: {
        Args: {
          p_client_request_id: string
          p_content_sha256: string
          p_media_family: string
          p_metadata?: Json
          p_owner_user_id: string
          p_provider: string
          p_provider_object_id?: string
          p_provider_path?: string
          p_scope_key: string
        }
        Returns: Json
      }
      reset_tier_config_override: {
        Args: { p_capability_key: string; p_tier_id: string }
        Returns: undefined
      }
      resolve_account_deletion_user_id_by_email: {
        Args: { p_email: string }
        Returns: string
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
      revoke_video_date_certification_feedback_exception_v1: {
        Args: {
          p_missing_user_id: string
          p_revoked_reason?: string
          p_session_id: string
        }
        Returns: Json
      }
      sanitize_profile_display_name: {
        Args: { p_input: string }
        Returns: string | null
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
      scrub_account_deletion_profile_pii_v1: {
        Args: { p_user_id: string }
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
      settle_event_ticket_checkout_20260523200000_phase2_base: {
        Args: {
          p_checkout_session_id: string
          p_event_id: string
          p_profile_id: string
        }
        Returns: Json
      }
      settle_event_ticket_checkout_20260601143000_terminal_base: {
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
      submit_post_date_verdict_v3: {
        Args: {
          p_idempotency_key: string
          p_liked: boolean
          p_request_hash?: string
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
      submit_video_date_safety_report_v2: {
        Args: {
          p_also_block?: boolean
          p_details?: string
          p_end_session?: boolean
          p_idempotency_key?: string
          p_reason: string
          p_session_id: string
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
      sync_post_date_zero_feedback_reminders_v1: {
        Args: { p_limit?: number; p_older_than?: string }
        Returns: number
      }
      sync_profile_photo_media: {
        Args: { p_avatar_path?: string; p_photos: string[]; p_user_id: string }
        Returns: Json
      }
      take_provider_rate_limit_token_v1: {
        Args: {
          p_bucket: string
          p_capacity?: number
          p_cost?: number
          p_provider: string
          p_refill_per_second?: number
        }
        Returns: Json
      }
      take_video_date_token_refresh_provider_rate_limit_v1: {
        Args: { p_bucket: string; p_session_id: string }
        Returns: Json
      }
      take_video_date_token_refresh_rate_limit_v1: {
        Args: never
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
      trigger_media_placeholder_backfill_now: {
        Args: { p_dry_run?: boolean; p_limit?: number }
        Returns: Json
      }
      trigger_video_date_orphan_cleanup_now: {
        Args: { p_dry_run?: boolean }
        Returns: Json
      }
      unblock_user: { Args: { p_blocked_id: string }; Returns: Json }
      unclaim_stale_event_reminder_queue_rows: {
        Args: { p_limit?: number; p_stale_after_seconds?: number }
        Returns: number
      }
      unmatch_match: { Args: { p_match_id: string }; Returns: Json }
      unregister_onesignal_push_subscription: {
        Args: {
          p_expected_user_id?: string
          p_platform?: string
          p_subscription_id?: string
        }
        Returns: undefined
      }
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
      update_vibe_video_upload_status: {
        Args: {
          p_error_detail?: string
          p_new_status: string
          p_provider_object_id: string
        }
        Returns: Json
      }
      upsert_media_asset: {
        Args: {
          p_bytes?: number
          p_content_sha256?: string
          p_legacy_id?: string
          p_legacy_table?: string
          p_media_family: string
          p_mime_type?: string
          p_owner_user_id?: string
          p_provider: string
          p_provider_object_id?: string
          p_provider_path?: string
          p_status?: string
        }
        Returns: Json
      }
      upsert_video_date_certification_feedback_exception_v1: {
        Args: {
          p_evidence?: Json
          p_exception_kind: string
          p_expires_at?: string
          p_missing_user_id: string
          p_reason: string
          p_session_id: string
        }
        Returns: Json
      }
      validate_video_date_registration_session_drift_v1: {
        Args: { p_event_id?: string; p_limit?: number }
        Returns: Json
      }
      vd_absence_review_1232_1242_base: {
        Args: { p_session_id: string; p_source?: string }
        Returns: Json
      }
      vd_absence_stable_media_base: {
        Args: { p_session_id: string; p_source?: string }
        Returns: Json
      }
      vd_auto_promote_eligible_base: {
        Args: {
          p_idempotency_key?: string
          p_request_hash?: string
          p_session_id: string
        }
        Returns: Json
      }
      vd_auto_promote_stable_media_base: {
        Args: {
          p_idempotency_key?: string
          p_request_hash?: string
          p_session_id: string
        }
        Returns: Json
      }
      vd_daily_webhook_terminal_truth_base: {
        Args: {
          p_event_type: string
          p_occurred_at?: string
          p_payload?: Json
          p_provider_event_id: string
          p_provider_participant_id?: string
          p_provider_user_id?: string
          p_room_name?: string
          p_signature_timestamp?: string
        }
        Returns: Json
      }
      vd_promote_ce_stable_media_base: {
        Args: {
          p_actor?: string
          p_reason?: string
          p_require_participant?: boolean
          p_session_id: string
          p_source?: string
        }
        Returns: Json
      }
      vd_provider_overlap_eligible_base: {
        Args: {
          p_actor?: string
          p_reason?: string
          p_require_participant?: boolean
          p_session_id: string
          p_source?: string
        }
        Returns: Json
      }
      vd_provider_overlap_stable_media_base: {
        Args: {
          p_actor?: string
          p_reason?: string
          p_require_participant?: boolean
          p_session_id: string
          p_source?: string
        }
        Returns: Json
      }
      vd_start_snapshot_both_ready_owner_base: {
        Args: { p_session_id: string }
        Returns: Json
      }
      vd_start_snapshot_partial_base: {
        Args: { p_session_id: string }
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
      vibe_video_upload_status_from_session: {
        Args: { p_status: string }
        Returns: string
      }
      video_date_active_surface_claims_v1: {
        Args: { p_session_id: string }
        Returns: Json
      }
      video_date_actor_provider_presence_v1: {
        Args: { p_actor_id: string; p_session_id: string }
        Returns: Json
      }
      video_date_both_ready_operator_diagnostics_v1: {
        Args: { p_event_id?: string; p_limit?: number }
        Returns: Json
      }
      video_date_both_ready_route_payload_v1: {
        Args: {
          p_actor_id?: string
          p_payload?: Json
          p_session_id: string
          p_source?: string
        }
        Returns: Json
      }
      video_date_broadcast_batched_v2_enabled: { Args: never; Returns: boolean }
      video_date_can_access_session_topic: {
        Args: { p_topic: string }
        Returns: boolean
      }
      video_date_certification_feedback_exception_active_v1: {
        Args: { p_missing_user_id: string; p_session_id: string }
        Returns: boolean
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
      video_date_command_request_hash_v2: {
        Args: {
          p_command_kind: string
          p_request_payload?: Json
          p_session_id: string
        }
        Returns: string
      }
      video_date_current_provider_session_proof_v1: {
        Args: {
          p_actor_id: string
          p_owner_state?: string
          p_provider_session_id: string
          p_session_id: string
          p_source?: string
        }
        Returns: Json
      }
      video_date_daily_provider_session_id_from_event_v1: {
        Args: { p_payload: Json; p_provider_participant_id: string }
        Returns: string
      }
      video_date_direct_json_fallback_v1: {
        Args: {
          p_actor_id: string
          p_code: string
          p_error: string
          p_retryable?: boolean
          p_rpc: string
          p_session_id: string
          p_sqlstate?: string
        }
        Returns: Json
      }
      video_date_enrich_lifecycle_payload_v1: {
        Args: { p_actor_id: string; p_payload: Json; p_session_id: string }
        Returns: Json
      }
      video_date_impression_rank: {
        Args: { p_reason: string }
        Returns: number
      }
      video_date_jsonb_has_secret_key: {
        Args: { p_value: Json }
        Returns: boolean
      }
      video_date_latest_presence_is_active: {
        Args: { p_away_at: string; p_joined_at: string }
        Returns: boolean
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
      video_date_lifecycle_client_safe_payload_v2: {
        Args: { p_payload: Json }
        Returns: Json
      }
      video_date_lifecycle_enrich_and_sanitize_payload_v2: {
        Args: {
          p_actor_id: string
          p_payload: Json
          p_rpc: string
          p_session_id: string
        }
        Returns: Json
      }
      video_date_lifecycle_exception_payload_v2: {
        Args: {
          p_actor_id: string
          p_code: string
          p_detail?: string
          p_error: string
          p_hint?: string
          p_message?: string
          p_retryable?: boolean
          p_rpc: string
          p_session_id: string
          p_sqlstate?: string
        }
        Returns: Json
      }
      video_date_lifecycle_failsoft_payload_v1: {
        Args: {
          p_actor_id: string
          p_code: string
          p_detail?: string
          p_error: string
          p_hint?: string
          p_message?: string
          p_retryable?: boolean
          p_rpc: string
          p_session_id: string
          p_sqlstate?: string
        }
        Returns: Json
      }
      video_date_lifecycle_jsonb_true_v1: {
        Args: { p_key: string; p_payload: Json }
        Returns: boolean
      }
      video_date_lifecycle_last_resort_payload_v2: {
        Args: {
          p_actor_id: string
          p_code: string
          p_error: string
          p_retryable?: boolean
          p_rpc: string
          p_session_id: string
          p_sqlstate?: string
        }
        Returns: Json
      }
      video_date_lifecycle_observe_exception_v2: {
        Args: {
          p_actor_id: string
          p_detail?: string
          p_hint?: string
          p_message?: string
          p_rpc: string
          p_session_id: string
          p_sqlstate: string
        }
        Returns: undefined
      }
      video_date_lifecycle_rpc_exception_observability_v1: {
        Args: {
          p_actor_id: string
          p_detail?: string
          p_hint?: string
          p_message?: string
          p_rpc: string
          p_session_id: string
          p_sqlstate: string
        }
        Returns: undefined
      }
      video_date_lifecycle_safe_failsoft_payload_v1: {
        Args: {
          p_actor_id: string
          p_code: string
          p_detail?: string
          p_error: string
          p_hint?: string
          p_message?: string
          p_retryable?: boolean
          p_rpc: string
          p_session_id: string
          p_sqlstate?: string
        }
        Returns: Json
      }
      video_date_lifecycle_sanitize_client_failsoft_payload_v1: {
        Args: { p_payload: Json }
        Returns: Json
      }
      video_date_lifecycle_terminal_context_v1: {
        Args: { p_actor_id?: string; p_session_id: string }
        Returns: Json
      }
      video_date_mark_stable_bilateral_media_v1: {
        Args: { p_gate: Json; p_session_id: string; p_source: string }
        Returns: Json
      }
      video_date_missing_feedback_operator_diagnostics_v1: {
        Args: { p_event_id?: string; p_limit?: number; p_stale_after?: string }
        Returns: {
          age_seconds: number
          ended_at: string
          event_id: string
          feedback_count: number
          missing_user_id: string
          participant_role: string
          queue_status: string
          release_blocker: boolean
          reminder_sent_at: string
          reminder_status: string
          session_id: string
        }[]
      }
      video_date_orphan_safety_interlock_v1: {
        Args: { p_room_name?: string; p_session_id: string }
        Returns: Json
      }
      video_date_outbox_enqueue_v2: {
        Args: {
          p_dedupe_key?: string
          p_kind: string
          p_next_attempt_at?: string
          p_payload?: Json
          p_session_id: string
        }
        Returns: Json
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
      video_date_partial_ready_diagnostics_v1: {
        Args: { p_event_id?: string; p_limit?: number }
        Returns: Json
      }
      video_date_participant_eligibility_v1: {
        Args: { p_profile_id: string; p_source?: string }
        Returns: Json
      }
      video_date_preserve_provider_webhook_truth_v1: {
        Args: {
          p_event_type: string
          p_occurred_at?: string
          p_payload?: Json
          p_provider_participant_id?: string
          p_provider_user_id?: string
          p_room_name: string
        }
        Returns: Json
      }
      video_date_promote_confirmed_encounter_v1: {
        Args: {
          p_actor?: string
          p_reason?: string
          p_require_participant?: boolean
          p_session_id: string
          p_source?: string
        }
        Returns: Json
      }
      video_date_promote_provider_overlap_v1: {
        Args: {
          p_actor?: string
          p_reason?: string
          p_require_participant?: boolean
          p_session_id: string
          p_source?: string
        }
        Returns: Json
      }
      video_date_protect_both_ready_entry_v1: {
        Args: {
          p_actor_id?: string
          p_entry_attempt_id?: string
          p_session_id: string
          p_source?: string
        }
        Returns: Json
      }
      video_date_ready_gate_actionability_v1: {
        Args: {
          p_actor_id?: string
          p_allow_actor_owned_snooze?: boolean
          p_lock_rows?: boolean
          p_require_current_ready_gate_registration?: boolean
          p_session_id: string
          p_source?: string
          p_terminalize_invalid?: boolean
        }
        Returns: Json
      }
      video_date_realtime_topic_is_session: {
        Args: { p_topic: string }
        Returns: boolean
      }
      video_date_reconcile_provider_absence_v1: {
        Args: { p_session_id: string; p_source?: string }
        Returns: Json
      }
      video_date_restore_canonical_room_metadata_v1: {
        Args: { p_session_id: string; p_source?: string }
        Returns: Json
      }
      video_date_session_has_confirmed_encounter: {
        Args: {
          p_date_started_at: string
          p_participant_1_joined_at: string
          p_participant_1_remote_seen_at: string
          p_participant_2_joined_at: string
          p_participant_2_remote_seen_at: string
          p_phase: string
          p_state: string
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
      video_date_session_is_post_date_survey_eligible_v2: {
        Args: {
          p_date_started_at: string
          p_ended_at: string
          p_ended_reason: string
          p_participant_1_joined_at: string
          p_participant_1_remote_seen_at: string
          p_participant_2_joined_at: string
          p_participant_2_remote_seen_at: string
          p_phase: string
          p_state: string
        }
        Returns: boolean
      }
      video_date_session_lifecycle_eligibility_v1: {
        Args: { p_actor_id?: string; p_session_id: string; p_source?: string }
        Returns: Json
      }
      video_date_stable_bilateral_media_gate_v1: {
        Args: { p_session_id: string }
        Returns: Json
      }
      video_date_stable_copresence_v1: {
        Args: { p_session_id: string }
        Returns: Json
      }
      video_date_terminalize_ready_gate_session_v1: {
        Args: {
          p_actor_id?: string
          p_detail?: Json
          p_reason?: string
          p_session_id: string
        }
        Returns: Json
      }
      video_date_transition: {
        Args: { p_action: string; p_reason?: string; p_session_id: string }
        Returns: Json
      }
      video_date_uuid_from_daily_room_name_v1: {
        Args: { p_room_name: string }
        Returns: string
      }
      video_session_blocks_global_active_conflict: {
        Args: {
          p_date_started_at: string
          p_ended_at: string
          p_entry_started_at: string
          p_event_id: string
          p_participant_1_joined_at: string
          p_participant_2_joined_at: string
          p_phase: string
          p_prepare_entry_expires_at: string
          p_ready_gate_expires_at: string
          p_ready_gate_status: string
          p_snooze_expires_at: string
          p_state: string
        }
        Returns: boolean
      }
      video_session_command_begin_v2: {
        Args: {
          p_actor: string
          p_command_kind: string
          p_idempotency_key: string
          p_request_hash?: string
          p_request_payload?: Json
          p_session_id: string
        }
        Returns: Json
      }
      video_session_command_finish_v2: {
        Args: {
          p_actor: string
          p_command_id: number
          p_result_payload?: Json
          p_status: string
        }
        Returns: Json
      }
      video_session_continue_entry_v2: {
        Args: {
          p_idempotency_key?: string
          p_request_hash?: string
          p_session_id: string
        }
        Returns: Json
      }
      video_session_date_timeout_v2: {
        Args: {
          p_idempotency_key?: string
          p_request_hash?: string
          p_session_id: string
        }
        Returns: Json
      }
      video_session_entry_auto_promote_v2: {
        Args: {
          p_idempotency_key?: string
          p_request_hash?: string
          p_session_id: string
        }
        Returns: Json
      }
      video_session_extend_date_v2: {
        Args: {
          p_credit_type: string
          p_idempotency_key?: string
          p_request_hash?: string
          p_session_id: string
        }
        Returns: Json
      }
      video_session_forfeit_v2: {
        Args: {
          p_idempotency_key?: string
          p_reason?: string
          p_request_hash?: string
          p_session_id: string
        }
        Returns: Json
      }
      video_session_mark_ready_grace_extend_v1: {
        Args: {
          p_actor: string
          p_idempotency_key: string
          p_retryable?: boolean
          p_session_id: string
          p_source?: string
        }
        Returns: Json
      }
      video_session_mark_ready_v2: {
        Args: {
          p_idempotency_key?: string
          p_request_hash?: string
          p_session_id: string
        }
        Returns: Json
      }
      video_session_request_extension_v2: {
        Args: {
          p_credit_type: string
          p_idempotency_key?: string
          p_request_hash?: string
          p_session_id: string
        }
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
      video_date_state: "ready_gate" | "entry" | "date" | "post_date" | "ended"
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
      video_date_state: ["ready_gate", "entry", "date", "post_date", "ended"],
    },
  },
} as const
