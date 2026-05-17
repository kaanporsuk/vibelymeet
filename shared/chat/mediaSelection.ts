export type MediaSelectionItem = {
  id: string;
  sourceRef?: string | null;
};

export function resolvePreservedMediaSelectionId<T extends MediaSelectionItem>({
  items,
  previousItems,
  previousId,
  initialId,
  initialChanged,
}: {
  items: readonly T[];
  previousItems: readonly T[];
  previousId: string;
  initialId: string;
  initialChanged: boolean;
}): string {
  const initialItemId = items.find((item) => item.id === initialId)?.id ?? items[0]?.id ?? initialId;
  if (!items.length) return initialId;
  if (initialChanged) return initialItemId;
  if (items.some((item) => item.id === previousId)) return previousId;

  const previousIndex = previousItems.findIndex((item) => item.id === previousId);
  const previousItem = previousIndex >= 0 ? previousItems[previousIndex] : null;
  if (previousItem?.sourceRef) {
    const sourceMatch = items.find((item) => item.sourceRef === previousItem.sourceRef);
    if (sourceMatch) return sourceMatch.id;
  }

  if (previousIndex >= 0) {
    return items[Math.min(previousIndex, items.length - 1)]?.id ?? initialItemId;
  }

  return initialItemId;
}
