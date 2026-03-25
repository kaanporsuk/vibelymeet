// Daily Drop Types — V2 Mutual Pair System

export interface DailyDropPartner {
  id: string;
  name: string;
  age: number;
  gender: string;
  about_me: string | null;
  avatar_url: string | null;
  photos: string[] | null;
  bunny_video_uid: string | null;
  bunny_video_status: string | null;
  vibe_caption: string | null;
  vibes: string[]; // vibe tag labels
}

/** Matches `daily_drops.status` CHECK constraint */
export type DailyDropStatus =
  | 'active_unopened'
  | 'active_viewed'
  | 'active_opener_sent'
  | 'matched'
  | 'passed'
  | 'expired_no_action'
  | 'expired_no_reply'
  | 'invalidated';

export interface DailyDropData {
  id: string;
  user_a_id: string;
  user_b_id: string;
  drop_date: string;
  starts_at: string;
  expires_at: string;
  status: DailyDropStatus;
  user_a_viewed: boolean;
  user_b_viewed: boolean;
  opener_sender_id: string | null;
  opener_text: string | null;
  opener_sent_at: string | null;
  reply_sender_id: string | null;
  reply_text: string | null;
  reply_sent_at: string | null;
  chat_unlocked: boolean;
  match_id: string | null;
  passed_by_user_id: string | null;
  pick_reasons: string[];
  affinity_score: number;
}

export interface PastDrop {
  id: string;
  partner_id: string;
  partner_name: string;
  partner_avatar: string | null;
  drop_date: string;
  status: string;
  match_id: string | null;
}
