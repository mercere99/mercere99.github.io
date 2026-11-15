import { parseStream, type EventStream } from "../campaign/events";
import type { DriveFile, GoogleDrive } from "./api";

export class StreamReader {
  private cache = new Map<string, {version?: string; stream: EventStream}>();
  constructor(private drive: GoogleDrive, private campaignId: string) {}
  async refresh(folderIds: string[], selectedFileIds: string[]) {
    const discovered = new Map<string, DriveFile>();
    const errors: string[] = [];
    for (const id of selectedFileIds) {
      try { const file = await this.drive.getFile(id); discovered.set(file.id,file); } catch(error) { errors.push(String((error as Error).message)); }
    }
    for (const folderId of new Set(folderIds)) {
      try {
        const children = await this.drive.children(folderId);
        for (const file of children) {
          if (file.mimeType === "application/vnd.google-apps.folder") {
            try { for (const streamFile of await this.drive.children(file.id)) discovered.set(streamFile.id,streamFile); }
            catch(error) { errors.push(`${file.name}: ${(error as Error).message}`); }
          } else discovered.set(file.id,file);
        }
      } catch(error) { errors.push((error as Error).message); }
    }
    const streams: EventStream[] = [];
    for (const file of discovered.values()) {
      if (file.appProperties?.arsKind !== "stream" || file.appProperties.arsCampaign !== this.campaignId) continue;
      try {
        const cached = this.cache.get(file.id);
        if (cached && cached.version && cached.version === file.version) { streams.push(cached.stream); continue; }
        const stream = parseStream(await this.drive.readStream(file.id,this.campaignId),this.campaignId);
        this.cache.set(file.id,{version:file.version,stream}); streams.push(stream);
      } catch(error) { errors.push(`${file.name}: ${(error as Error).message}`); }
    }
    return { streams, errors, observedAt: new Date().toISOString() };
  }
}
