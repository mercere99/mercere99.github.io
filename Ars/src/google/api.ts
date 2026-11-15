import type { EventStream } from "../campaign/events";
import { parseStream } from "../campaign/events";
import { nativeRequests } from "../sheets/workbook";
import type { WorkbookPlan } from "../sheets/contract";
export interface DriveFile { id: string; name: string; mimeType: string; parents?: string[]; ownedByMe?: boolean; version?: string; appProperties?: Record<string,string> }
export interface SpreadsheetMetadata { spreadsheetId: string; namedRanges?: {name: string}[]; sheets: {properties: {sheetId: number; title: string}}[] }
export interface CreationAttempt { operationId: string; state: "new" | "creating" | "initializing" | "complete" | "uncertain"; fileId?: string }
export class GoogleError extends Error { constructor(message: string, readonly status: number) { super(message); } }
const ROOT = "https://www.googleapis.com/drive/v3";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const FIELDS = "id,name,mimeType,parents,ownedByMe,version,appProperties";
function fileId(id: string) { if (!/^[a-zA-Z0-9_-]{8,200}$/.test(id)) throw new Error("Invalid Google file ID."); return id; }
const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
export class GoogleDrive {
  // Browser fetch requires its global receiver; calling a stored reference as
  // this.fetcher() would bind it to GoogleDrive instead of Window.
  constructor(private token: () => string, private fetcher: typeof fetch = (...args) => globalThis.fetch(...args)) {}
  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.token()}`);
    const response = await this.fetcher(url, { ...init, headers });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as {error?: {message?: string}};
      const hint = response.status === 401 ? "Google authorization expired. Connect again." : response.status === 403 ? "Google denied access. Check sharing and select the file in Google's picker to authorize this app." : response.status === 429 ? "Google is rate-limiting requests. Wait before refreshing." : data.error?.message ?? `Google request failed (${response.status}).`;
      throw new GoogleError(hint, response.status);
    }
    return response.status === 204 ? undefined as T : response.json();
  }
  private json<T>(url: string, method: string, body: unknown) { return this.request<T>(url, { method, headers: {"Content-Type":"application/json"}, body: JSON.stringify(body) }); }
  account() { return this.request<{user: {permissionId: string; displayName: string}}>(`${ROOT}/about?fields=user(permissionId,displayName)`); }
  getFile(id: string) { return this.request<DriveFile>(`${ROOT}/files/${fileId(id)}?fields=${FIELDS}`); }
  async list(query: string) {
    const files: DriveFile[] = [];
    let page = "";
    do {
      const params = new URLSearchParams({ q: `trashed = false and (${query})`, fields: `nextPageToken,files(${FIELDS})`, pageSize: "100" });
      if (page) params.set("pageToken", page);
      const result = await this.request<{files?: DriveFile[]; nextPageToken?: string}>(`${ROOT}/files?${params}`);
      files.push(...(result.files ?? [])); page = result.nextPageToken ?? "";
      if (files.length > 2000) throw new Error("This folder is too large for the current prototype. Select a smaller session folder.");
    } while (page);
    return files;
  }
  children(id: string) { return this.list(`'${fileId(id)}' in parents`); }
  async createFolder(name: string, parent?: string) {
    return this.json<DriveFile>(`${ROOT}/files?fields=${FIELDS}`, "POST", { name, mimeType: "application/vnd.google-apps.folder", ...(parent ? {parents:[fileId(parent)]} : {}) });
  }
  async createFolderOnce(name: string, parent: string | undefined, attempt: CreationAttempt, checkpoint: (value: CreationAttempt) => void) {
    const matches=await this.list(`appProperties has { key='arsFolderOperation' and value='${escape(attempt.operationId)}' }`);
    if(matches.length>1)throw new Error("Duplicate setup folders found. Inspect Drive before continuing.");
    let folder=attempt.fileId?await this.getFile(attempt.fileId):matches[0];
    if(!folder){
      if(attempt.state!=="new")throw new Error("The earlier folder creation outcome is uncertain. Retry to look again; another folder will not be created automatically.");
      checkpoint({...attempt,state:"creating"});
      try {folder=await this.json<DriveFile>(`${ROOT}/files?fields=${FIELDS}`,"POST",{name,mimeType:"application/vnd.google-apps.folder",...(parent?{parents:[fileId(parent)]}:{}),appProperties:{arsFolderOperation:attempt.operationId}});}
      catch(error){checkpoint({...attempt,state:"uncertain"});throw error;}
    }
    if(!folder.ownedByMe||folder.mimeType!=="application/vnd.google-apps.folder"||folder.appProperties?.arsFolderOperation!==attempt.operationId)throw new Error("This setup folder does not belong to the current creation operation.");
    checkpoint({...attempt,fileId:folder.id,state:"complete"});return folder;
  }
  spreadsheetMetadata(id: string) { return this.request<SpreadsheetMetadata>(`${SHEETS}/${fileId(id)}?fields=spreadsheetId,namedRanges(name),sheets(properties(sheetId,title))`); }
  async values(id: string, ranges: string[]) {
    const params = new URLSearchParams({ valueRenderOption: "UNFORMATTED_VALUE" });
    for (const range of ranges) params.append("ranges", range);
    return this.request<{valueRanges?: {range: string; values?: unknown[][]}[]}>(`${SHEETS}/${fileId(id)}/values:batchGet?${params}`);
  }
  async createWorkbook(plan: WorkbookPlan, attempt: CreationAttempt, checkpoint: (attempt: CreationAttempt) => void, folder?: string): Promise<string> {
    const existing = await this.list(`appProperties has { key='arsOperation' and value='${escape(attempt.operationId)}' }`);
    if (existing.length > 1) throw new Error("More than one file matches this creation attempt. Inspect Drive before continuing.");
    let created = attempt.fileId ? await this.getFile(attempt.fileId) : existing[0];
    if (!created) {
      if (attempt.state !== "new") throw new Error("The earlier creation outcome is uncertain. Check Drive and use Retry to look again; this app will not create another copy automatically.");
      checkpoint({ ...attempt, state: "creating" });
      try {
        created = await this.json<DriveFile>(`${ROOT}/files?fields=${FIELDS}`, "POST", { name: plan.title, mimeType: "application/vnd.google-apps.spreadsheet", ...(folder ? {parents:[fileId(folder)]} : {}), appProperties: { arsOperation: attempt.operationId, arsKind: "workbook" } });
      } catch (error) { checkpoint({ ...attempt, state: "uncertain" }); throw error; }
    }
    if (!created.ownedByMe || created.appProperties?.arsOperation !== attempt.operationId) throw new Error("Initialization is only allowed for a new workbook created by this operation.");
    const id = created.id;
    checkpoint({ ...attempt, fileId: id, state: "initializing" });
    const meta = await this.spreadsheetMetadata(id);
    if (created.appProperties?.arsInitialized === "1" || meta.namedRanges?.some(r => r.name.startsWith("ars_"))) {
      checkpoint({ ...attempt, fileId: id, state: "complete" }); return id;
    }
    // Allocate different sheet IDs, add new sheets, THEN remove the initial blank tab.
    const oldIds = new Set(meta.sheets.map(s => s.properties.sheetId));
    let offset = 1000;
    while (plan.tabs.some(t => oldIds.has(t.id + offset))) offset += 100;
    const shifted: WorkbookPlan = { ...plan, tabs: plan.tabs.map(t => ({...t,id:t.id+offset})), ranges:plan.ranges.map(r=>({...r,tabId:r.tabId+offset})), validations:plan.validations.map(v=>({...v,tabId:v.tabId+offset})) };
    await this.json(`${SHEETS}/${fileId(id)}:batchUpdate`, "POST", { requests: [...nativeRequests(shifted), ...meta.sheets.map(s => ({deleteSheet:{sheetId:s.properties.sheetId}}))] });
    await this.json(`${ROOT}/files/${fileId(id)}?fields=id`, "PATCH", { appProperties: { ...created.appProperties, arsInitialized: "1" } });
    checkpoint({ ...attempt, fileId: id, state: "complete" });
    return id;
  }
  async createStream(stream: EventStream, folder: string) {
    const existing = await this.list(`appProperties has { key='arsSession' and value='${escape(stream.sessionId)}' }`);
    if (existing.length) {
      if (existing.length > 1) throw new Error("Duplicate session files found. Select a new session folder.");
      return existing[0]!;
    }
    const boundary = `ars_${crypto.randomUUID()}`;
    const meta = { name: `Session ${stream.sessionId.slice(0,8)}.json`, mimeType: "application/json", parents:[fileId(folder)], appProperties: {arsKind:"stream",arsCampaign:stream.campaignId,arsActor:stream.actorId,arsSession:stream.sessionId} };
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(stream)}\r\n--${boundary}--`;
    return this.request<DriveFile>(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${FIELDS}`, { method:"POST",headers:{"Content-Type":`multipart/related; boundary=${boundary}`},body });
  }
  readStream(id: string, campaignId: string) { return this.request<unknown>(`${ROOT}/files/${fileId(id)}?alt=media`).then(value => parseStream(value,campaignId)); }
  writeStream(id: string, stream: EventStream) {
    // Same-origin tabs share the outbox; serialize recovery with the live writer.
    return typeof navigator!=="undefined" && navigator.locks
      ? navigator.locks.request(`ars:stream:${id}`,()=>this.writeOwnedStream(id,stream))
      : this.writeOwnedStream(id,stream);
  }
  private async writeOwnedStream(id: string, stream: EventStream) {
    const meta = await this.getFile(id);
    if (!meta.ownedByMe || meta.appProperties?.arsSession !== stream.sessionId || meta.appProperties.arsActor !== stream.actorId || meta.appProperties.arsCampaign !== stream.campaignId) throw new Error("Only the originating member can update this session file.");
    const remote = await this.readStream(id,stream.campaignId);
    const prefix = (a: EventStream, b: EventStream) => a.events.every((event,i)=>JSON.stringify(event)===JSON.stringify(b.events[i]));
    // Recovery can run in another tab. Never replace an acknowledged newer history.
    if (prefix(stream,remote)) return remote;
    if (!prefix(remote,stream)) throw new Error("The remote session history differs from this queued upload. It was preserved; inspect the session file before retrying.");
    // One browser session owns this file; retries write identical event IDs/results.
    await this.request<DriveFile>(`https://www.googleapis.com/upload/drive/v3/files/${fileId(id)}?uploadType=media&fields=${FIELDS}`, {method:"PATCH", headers:{"Content-Type":"application/json"},body:JSON.stringify(stream)});
    return stream;
  }
}
