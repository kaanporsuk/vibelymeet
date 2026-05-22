export const VIDEO_DATE_DECK_BUFFER_LIMIT = 5;
export const VIDEO_DATE_DECK_TOP_UP_THRESHOLD = 2;

export function shouldTopUpVideoDateDeck(remainingVisibleCount: number): boolean {
  return remainingVisibleCount <= VIDEO_DATE_DECK_TOP_UP_THRESHOLD;
}
