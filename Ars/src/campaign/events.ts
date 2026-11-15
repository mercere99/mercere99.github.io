export interface SessionEvent {
  id: string;
  campaignId: string;
  actorId: string;
  sessionId: string;
  sequence: number;
  logicalTime: number;
  createdAt: string;
  type: "probe" | "register-record" | "storyguide-takeover" | "dice-roll";
  payload: Record<string, unknown>;
}
export interface EventStream {
  schemaVersion: 1;
  campaignId: string;
  actorId: string;
  sessionId: string;
  events: SessionEvent[];
}
export function newStream(campaignId: string, actorId: string): EventStream {
  return { schemaVersion: 1, campaignId, actorId, sessionId: crypto.randomUUID(), events: [] };
}
export function appendEvent(stream: EventStream, type: SessionEvent["type"], payload: SessionEvent["payload"], observed: SessionEvent[] = []): EventStream {
  if (stream.events.length >= 5000) throw new Error("This session history is full. Reload to start a new session file.");
  const last = Math.max(0, ...stream.events.map(e => e.logicalTime), ...observed.map(e => e.logicalTime));
  const event: SessionEvent = {
    id: crypto.randomUUID(), campaignId: stream.campaignId, actorId: stream.actorId,
    sessionId: stream.sessionId, sequence: stream.events.length + 1, logicalTime: last + 1,
    createdAt: new Date().toISOString(), type, payload,
  };
  return { ...stream, events: [...stream.events, event] };
}
export function parseStream(value: unknown, campaignId: string): EventStream {
  const s = value as EventStream;
  if (!s || s.schemaVersion !== 1 || s.campaignId !== campaignId || typeof s.actorId !== "string" || typeof s.sessionId !== "string" || !Array.isArray(s.events)) throw new Error("This is not an event stream for this campaign.");
  if (s.events.length > 5000) throw new Error("This session history is too large. Start a new session file.");
  const ids = new Set<string>();
  for (let i = 0; i < s.events.length; i++) {
    const e = s.events[i]!;
    if (!e || typeof e.id !== "string" || ids.has(e.id) || e.campaignId !== campaignId || e.actorId !== s.actorId || e.sessionId !== s.sessionId || e.sequence !== i + 1 || !Number.isSafeInteger(e.logicalTime) || e.logicalTime < 1 || (i > 0 && e.logicalTime <= s.events[i-1]!.logicalTime) || !Number.isFinite(Date.parse(e.createdAt)) || !["probe", "register-record", "storyguide-takeover", "dice-roll"].includes(e.type) || typeof e.payload !== "object" || e.payload === null || Array.isArray(e.payload)) throw new Error("Invalid session event history.");
    ids.add(e.id);
  }
  return s;
}
export function mergeEvents(streams: EventStream[]): SessionEvent[] {
  const unique = new Map<string, SessionEvent>();
  for (const stream of streams) for (const event of stream.events) {
    const previous = unique.get(event.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) throw new Error("Conflicting events have the same ID.");
    unique.set(event.id, event);
  }
  return [...unique.values()].sort((a, b) => a.logicalTime - b.logicalTime || a.actorId.localeCompare(b.actorId) || a.sessionId.localeCompare(b.sessionId) || a.sequence - b.sequence || a.id.localeCompare(b.id));
}
