type SupabaseRealtimeClientLike<TChannel = unknown> = {
  getChannels?: () => TChannel[];
  removeChannel?: (channel: TChannel) => unknown;
  removeAllChannels?: () => unknown;
};

function normalizeRealtimeTopic(channelNameOrTopic: string): string {
  return channelNameOrTopic.replace(/^realtime:/, '');
}

function channelTopic(channel: unknown): string | null {
  if (!channel || typeof channel !== 'object') return null;
  const record = channel as Record<string, unknown>;
  const rawTopic =
    typeof record.topic === 'string'
      ? record.topic
      : typeof record.subTopic === 'string'
        ? record.subTopic
        : null;
  return rawTopic ? normalizeRealtimeTopic(rawTopic) : null;
}

export function pruneDuplicateRealtimeChannels<TChannel>(
  client: SupabaseRealtimeClientLike<TChannel>,
  _reason: string,
): number {
  if (typeof client.getChannels !== 'function' || typeof client.removeChannel !== 'function') return 0;
  const channels = client.getChannels();
  const seenFromNewest = new Set<string>();
  let removed = 0;

  for (let index = channels.length - 1; index >= 0; index -= 1) {
    const channel = channels[index];
    const topic = channelTopic(channel);
    if (!topic) continue;
    if (!seenFromNewest.has(topic)) {
      seenFromNewest.add(topic);
      continue;
    }
    removed += 1;
    void client.removeChannel(channel);
  }

  return removed;
}

export function removeAllRealtimeChannels<TChannel>(
  client: SupabaseRealtimeClientLike<TChannel>,
  _reason: string,
): void {
  if (typeof client.getChannels === 'function' && typeof client.removeChannel === 'function') {
    for (const channel of client.getChannels()) {
      void client.removeChannel(channel);
    }
    return;
  }

  if (typeof client.removeAllChannels === 'function') {
    void client.removeAllChannels();
  }
}
