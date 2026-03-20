export const STATUS_CONFIG = {
  submitted: { label: 'Submitted', color: '#6B7280' },
  in_review: { label: 'In Review', color: '#8B5CF6' },
  waiting_on_user: { label: 'Waiting on you', color: '#F59E0B' },
  resolved: { label: 'Resolved', color: '#22D3EE' },
} as const;

export type SupportStatus = keyof typeof STATUS_CONFIG;

export const PRIORITY_CONFIG = {
  urgent: { label: 'Urgent', color: '#EF4444' },
  high: { label: 'High', color: '#F59E0B' },
  normal: { label: 'Normal', color: '#6B7280' },
  low: { label: 'Low', color: '#4B5563' },
} as const;

export type SupportPriority = keyof typeof PRIORITY_CONFIG;
