import {
  resolveEventLifecycle,
  type EventLifecycleInput,
  type EventLifecycleSnapshot,
} from "./eventLifecycle";

export type EventCardLifecycleSnapshot = EventLifecycleSnapshot & {
  isLive: boolean;
  showEnded: boolean;
};

export function resolveEventCardLifecycle(input: EventLifecycleInput): EventCardLifecycleSnapshot {
  const lifecycle = resolveEventLifecycle(input);
  const showEnded = lifecycle.isArchived || lifecycle.isEnded;

  return {
    ...lifecycle,
    isLive: lifecycle.isLive && !showEnded,
    showEnded,
  };
}
