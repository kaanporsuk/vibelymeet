export type PrimaryType = 'support' | 'feedback' | 'safety';

export interface CategoryConfig {
  label: string;
  icon: string;
  description: string;
  color: string;
  subcategories: string[];
  smartFields?: SmartField[];
}

export interface SmartField {
  key: string;
  label: string;
  type: 'text' | 'select';
  options?: string[];
  placeholder?: string;
}

export const SUPPORT_CATEGORIES: Record<PrimaryType, CategoryConfig> = {
  support: {
    label: 'Get Support',
    icon: 'help-circle-outline',
    description: 'Technical issues, billing, account help',
    color: '#8B5CF6',
    subcategories: [
      'Account & login',
      'Billing & premium',
      'Payment failed or refund',
      'Events & tickets',
      'Matches & messages',
      'Notifications',
      'Profile & media',
      'Photo or verification issue',
      'Video dates & calls',
      'Other support',
    ],
    smartFields: [
      {
        key: 'what_happened',
        label: 'What happened?',
        type: 'text',
        placeholder: 'Describe what you experienced',
      },
      {
        key: 'expected',
        label: 'What did you expect?',
        type: 'text',
        placeholder: 'What should have happened',
      },
      {
        key: 'reproducible',
        label: 'Can you reproduce this?',
        type: 'select',
        options: ['Always', 'Sometimes', "Can't reproduce"],
      },
    ],
  },
  feedback: {
    label: 'Share Feedback',
    icon: 'bulb-outline',
    description: 'Ideas, bugs, and product improvements',
    color: '#22D3EE',
    subcategories: [
      'Feature idea',
      'UX improvement',
      'Report a bug',
      'Performance issue',
      'Other feedback',
    ],
    smartFields: [
      {
        key: 'what_happened',
        label: 'What did you notice?',
        type: 'text',
        placeholder: 'Describe the issue or idea',
      },
      {
        key: 'where',
        label: 'Where in the app?',
        type: 'text',
        placeholder: 'e.g. Events screen, Chat, Profile',
      },
    ],
  },
  safety: {
    label: 'Report Safety Issue',
    icon: 'shield-checkmark-outline',
    description: 'Harassment, fake profiles, abuse',
    color: '#F59E0B',
    subcategories: [
      'Harassment or abusive behavior',
      'Fake profile or scam',
      'Matched with someone I know',
      'Inappropriate content',
      'Underage user',
      'Unsafe in-person experience',
      'Moderation / appeal',
      'Other safety issue',
    ],
    smartFields: [
      {
        key: 'who_involved',
        label: 'Who was involved?',
        type: 'text',
        placeholder: 'Username or profile name if known',
      },
      {
        key: 'when',
        label: 'When did this happen?',
        type: 'text',
        placeholder: 'Approximate date and time',
      },
      {
        key: 'where_occurred',
        label: 'Where did it happen?',
        type: 'select',
        options: ['Profile', 'Match / Chat', 'Event', 'Video date', 'In person', 'Other'],
      },
    ],
  },
};

export const PRIORITY_BY_TYPE: Record<PrimaryType, string> = {
  support: 'normal',
  feedback: 'low',
  safety: 'urgent',
};
