// VibeArcade Game Types - Backend Ready Data Structures

import { WOULD_RATHER_PROMPT_PAIRS } from "../../shared/vibely-games/wouldRatherPrompts";

export type GameType = '2truths' | 'would_rather' | 'charades' | 'scavenger' | 'roulette' | 'intuition';
export type GameStep = 'created' | 'active' | 'completed';

// Base game payload structure
export interface BaseGamePayload {
  gameType: GameType;
  step: GameStep;
}

// Two Truths & A Lie
export interface TwoTruthsPayload extends BaseGamePayload {
  gameType: '2truths';
  data: {
    statements: string[];
    lieIndex: number; // Index of the lie (0, 1, or 2)
    guessedIndex?: number; // Receiver's guess
    isCorrect?: boolean;
  };
}

// Would You Rather
export interface WouldRatherPayload extends BaseGamePayload {
  gameType: 'would_rather';
  data: {
    optionA: string;
    optionB: string;
    senderVote?: 'A' | 'B';
    receiverVote?: 'A' | 'B';
    isMatch?: boolean;
  };
}

// Emoji Charades
export interface CharadesPayload extends BaseGamePayload {
  gameType: 'charades';
  data: {
    answer: string; // The movie/song title
    emojis: string[];
    guesses: string[];
    isGuessed?: boolean;
  };
}

// Photo Scavenger Hunt
export interface ScavengerPayload extends BaseGamePayload {
  gameType: 'scavenger';
  data: {
    prompt: string;
    senderPhotoUrl?: string;
    receiverPhotoUrl?: string;
    isUnlocked: boolean;
  };
}

// Vibe Roulette (Deep Questions)
export interface RoulettePayload extends BaseGamePayload {
  gameType: 'roulette';
  data: {
    question: string;
    senderAnswer: string;
    receiverAnswer?: string;
    isUnlocked: boolean;
  };
}

// Intuition Test
export interface IntuitionPayload extends BaseGamePayload {
  gameType: 'intuition';
  data: {
    prediction: string; // What sender thinks receiver prefers
    options: [string, string]; // The two options
    senderChoice: 0 | 1; // Index of sender's prediction
    receiverResponse?: 'correct' | 'wrong';
  };
}

// Union type for all game payloads
export type GamePayload =
  | TwoTruthsPayload
  | WouldRatherPayload
  | CharadesPayload
  | ScavengerPayload
  | RoulettePayload
  | IntuitionPayload;

// Extended message type for games
export interface GameMessage {
  id: string;
  senderId: string;
  type: 'text' | 'game_interactive';
  text?: string;
  sender: 'me' | 'them';
  time: string;
  gamePayload?: GamePayload;
}

// Game definition for the arcade menu
export interface GameDefinition {
  type: GameType;
  name: string;
  description: string;
  icon: string;
  color: string;
}

// All available games
export const ARCADE_GAMES: GameDefinition[] = [
  {
    type: '2truths',
    name: 'Two Truths & A Lie',
    description: 'Can they spot your fib?',
    icon: '🎭',
    color: 'from-pink-500 to-rose-600',
  },
  {
    type: 'would_rather',
    name: 'Would You Rather?',
    description: 'Sync your preferences',
    icon: '⚡',
    color: 'from-amber-500 to-orange-600',
  },
  {
    type: 'charades',
    name: 'Emoji Charades',
    description: 'Guess the movie/song',
    icon: '👻',
    color: 'from-purple-500 to-violet-600',
  },
  {
    type: 'scavenger',
    name: 'Scavenger Hunt',
    description: 'Share photos, BeReal style',
    icon: '📸',
    color: 'from-green-500 to-emerald-600',
  },
  {
    type: 'roulette',
    name: 'Vibe Roulette',
    description: 'Deep questions, mutual reveal',
    icon: '🎡',
    color: 'from-cyan-500 to-teal-600',
  },
  {
    type: 'intuition',
    name: 'Intuition Test',
    description: 'Read their mind',
    icon: '🔮',
    color: 'from-indigo-500 to-blue-600',
  },
];

/** CamelCase view of `WOULD_RATHER_PROMPT_PAIRS` (web arcade). */
export const WOULD_RATHER_OPTIONS = WOULD_RATHER_PROMPT_PAIRS.map((p) => ({
  optionA: p.option_a,
  optionB: p.option_b,
}));

// Mock data for Scavenger Hunt prompts
export const SCAVENGER_PROMPTS = [
  'Show me... your fridge',
  'Show me... your view right now',
  'Show me... your favorite mug',
  'Show me... something that makes you smile',
  'Show me... your current mood as an object',
  'Show me... the last thing you bought',
  'Show me... your workspace',
  'Show me... something purple',
];

// Mock data for Vibe Roulette questions
export const ROULETTE_QUESTIONS = [
  'What\'s your biggest regret?',
  'What\'s the most spontaneous thing you\'ve ever done?',
  'What\'s your guilty pleasure?',
  'What\'s a secret talent you have?',
  'What\'s your earliest memory?',
  'What would your perfect day look like?',
  'What\'s something you\'ve never told anyone?',
  'What\'s the best advice you\'ve ever received?',
];

// Mock data for Intuition Test options
export const INTUITION_OPTIONS = [
  ['Staying In', 'Going Out'],
  ['Coffee', 'Tea'],
  ['Morning Person', 'Night Owl'],
  ['Sweet', 'Savory'],
  ['Beach', 'Mountains'],
  ['Cats', 'Dogs'],
  ['Books', 'Movies'],
  ['Plan Everything', 'Go With The Flow'],
];
