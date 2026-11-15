import { parseStream, type EventStream } from "../campaign/events";

export interface PendingUpload { key: string; stream: EventStream; fileId?: string; folderId: string }
const prefix = (campaignId: string, actorId: string) => `ars:pending:${campaignId}:${actorId}:`;
export function savePending(storage: Storage, stream: EventStream, folderId: string, fileId?: string) {
  const key = prefix(stream.campaignId, stream.actorId) + stream.sessionId;
  storage.setItem(key, JSON.stringify({stream,folderId,fileId}));
  return key;
}
export function pendingUploads(storage: Storage, campaignId: string, actorId: string): PendingUpload[] {
  const uploads: PendingUpload[] = [];
  for (let i=0;i<storage.length;i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix(campaignId,actorId))) continue;
    const value = JSON.parse(storage.getItem(key)!);
    const stream = parseStream(value.stream,campaignId);
    if (stream.actorId !== actorId || typeof value.folderId !== "string" || (value.fileId != null && typeof value.fileId !== "string")) throw new Error("A queued event has invalid ownership or destination data.");
    uploads.push({key,stream,folderId:value.folderId,fileId:value.fileId});
  }
  return uploads;
}
