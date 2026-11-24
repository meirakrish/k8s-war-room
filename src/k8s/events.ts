/**
 * Turns raw `kubectl events -o json` output into a short, time-ordered summary for the model.
 */

export interface EventSummary {
  /** "Normal" or "Warning". */
  type: string;
  reason: string;
  /** What the event is about, e.g. a Pod or a Deployment. */
  object: { kind: string; name: string };
  message: string;
  /** How many times it happened. */
  count: number;
  /** When it last happened (ISO time). */
  lastSeen: string | null;
}

interface RawEvent {
  type: string;
  reason: string;
  involvedObject: { kind: string; name: string };
  message: string;
  count: number;
  lastTimestamp: string | null;
  eventTime: string | null;
  series?: { lastObservedTime: string | null };
}

const MAX_MESSAGE_LENGTH = 1000;
const MAX_RES_LENGTH = 50;

/** `eventList` is the parsed JSON of `kubectl events -o json`. */
export const summarizeEvents = (_eventList: { items: RawEvent[] }): EventSummary[] => {
  const es: EventSummary[] = _eventList.items.map((x) => ({
    type: x.type,
    reason: x.reason,
    message: x.message.substring(0, MAX_MESSAGE_LENGTH),
    count: x.count,
    object: { kind: x.involvedObject.kind, name: x.involvedObject.name },
    lastSeen: x?.series?.lastObservedTime || x.lastTimestamp || x.eventTime,
  }));

  return es
    .sort((a, b) => (a.lastSeen ? Date.parse(a.lastSeen) : 0) - (b.lastSeen ? Date.parse(b.lastSeen) : 0))
    .slice(-MAX_RES_LENGTH);
};
