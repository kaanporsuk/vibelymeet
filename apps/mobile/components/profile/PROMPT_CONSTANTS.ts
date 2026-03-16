/**
 * Default prompt questions — web parity (ProfilePrompt.tsx, PromptSelector).
 */
export const PROMPT_EMOJIS: Record<string, string> = {
  'A shower thought I had recently': '🚿',
  'My simple pleasures': '✨',
  'The way to win me over': '💫',
  'I geek out on': '🤓',
  'Together, we could': '🌙',
  'My most controversial opinion': '🔥',
  "I'm looking for": '🔮',
  'A life goal of mine': '🎯',
  'My love language is': '💕',
  'Two truths and a lie': '🎭',
};

export const AVAILABLE_PROMPTS = [
  'A shower thought I had recently',
  'My simple pleasures',
  'The way to win me over',
  'I geek out on',
  'Together, we could',
  'My most controversial opinion',
  "I'm looking for",
  'A life goal of mine',
  'My love language is',
  'Two truths and a lie',
] as const;
