export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export interface GoogleConfig { clientId: string; apiKey: string; appId: string }
export function googleConfig(): GoogleConfig {
  return { clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "", apiKey: import.meta.env.VITE_GOOGLE_API_KEY ?? "", appId: import.meta.env.VITE_GOOGLE_APP_ID ?? "" };
}
export function configured(config: GoogleConfig) { return !!(config.clientId && config.apiKey && config.appId); }
interface TokenResponse { access_token?: string; expires_in?: number; error?: string; error_description?: string; scope?: string }
interface PickerData { action?: string; docs?: { id: string; name: string; mimeType?: string }[] }
interface PickerView { setIncludeFolders(value: boolean): PickerView; setSelectFolderEnabled(value: boolean): PickerView; setMimeTypes(value: string): PickerView }
interface PickerBuilder { setAppId(value: string): PickerBuilder; setOAuthToken(value: string): PickerBuilder; setDeveloperKey(value: string): PickerBuilder; setOrigin(value: string): PickerBuilder; addView(view: PickerView): PickerBuilder; setCallback(fn: (data: PickerData) => void): PickerBuilder; enableFeature(feature: string): PickerBuilder; build(): { setVisible(value: boolean): void } }
interface GoogleSdk {
  accounts: { oauth2: {
    initTokenClient(config: { client_id: string; scope: string; callback: (response: TokenResponse) => void; error_callback: (error: {type: string}) => void }): { requestAccessToken(config: {prompt: string}): void };
    revoke(token: string, done: () => void): void;
  } };
  picker: { DocsView: new () => PickerView; PickerBuilder: new () => PickerBuilder; Feature: { MULTISELECT_ENABLED: string } };
}
const sdk = () => (window as unknown as { google: GoogleSdk }).google;
const scripts = new Map<string, Promise<void>>();
function loadScript(url: string): Promise<void> {
  if (!scripts.has(url)) scripts.set(url, new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url; script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { scripts.delete(url); script.remove(); reject(new Error("Google's sign-in library could not load. Check the connection or content blocker.")); };
    document.head.append(script);
  }));
  return scripts.get(url)!;
}
export class GoogleSession {
  private token = "";
  private expiresAt = 0;
  private prepared?: Promise<void>;
  private get rememberedKey() { return `ars:google-authorized:${this.config.clientId}`; }
  get previouslyAuthorized() { try { return localStorage.getItem(this.rememberedKey)==="1"; } catch { return false; } }
  constructor(readonly config: GoogleConfig, hasLinkedCampaign = false) {
    // An existing linked campaign also records a past connection. An explicit
    // Disconnect choice takes precedence over that hint on later visits.
    try {if(hasLinkedCampaign && localStorage.getItem(this.rememberedKey)===null)localStorage.setItem(this.rememberedKey,"1");} catch { /* Storage is optional. */ }
  }
  get connected() { return !!this.token && Date.now() < this.expiresAt; }
  accessToken = () => {
    if (!this.connected) throw new Error("Google authorization expired or is missing. Connect to Google again.");
    return this.token;
  };
  async prepare() {
    if (!configured(this.config)) throw new Error("Google connection has not been configured for this copy of the app.");
    if (!this.prepared) this.prepared = Promise.all([
      loadScript("https://accounts.google.com/gsi/client"),
      loadScript("https://apis.google.com/js/api.js").then(() => new Promise<void>((resolve, reject) => {
        const gapi = (window as unknown as { gapi: { load(name: string, options: {callback: () => void; onerror: () => void; timeout: number; ontimeout: () => void}): void } }).gapi;
        const fail = () => reject(new Error("Google's file picker could not load."));
        gapi.load("picker", { callback: resolve, onerror: fail, timeout: 15000, ontimeout: fail });
      })),
    ]).then(() => undefined).catch(error => { this.prepared = undefined; throw error; });
    return this.prepared;
  }
  authorize(options: {reuseAccount?: boolean} = {}): Promise<void> {
    // Libraries are prepared before this user-click handler, preserving popup activation.
    return new Promise((resolve, reject) => {
      const client = sdk().accounts.oauth2.initTokenClient({
        client_id: this.config.clientId, scope: DRIVE_SCOPE,
        callback: response => {
          if (response.error || !response.access_token) { reject(new Error(response.error_description ?? response.error ?? "Google did not return authorization.")); return; }
          if (!response.scope?.split(" ").includes(DRIVE_SCOPE)) { reject(new Error("Access to selected Google Drive files was not granted.")); return; }
          this.token = response.access_token;
          this.expiresAt = Date.now() + Math.max(0, (Number(response.expires_in) || 3600) - 60) * 1000;
          // Remember only the preference to reconnect, never the token itself.
          try {localStorage.setItem(this.rememberedKey,"1");} catch { /* Private browsing may disable persistence. */ }
          resolve();
        },
        error_callback: error => reject(new Error(`Google sign-in did not complete (${error.type}). Try Connect again.`)),
      });
      client.requestAccessToken({ prompt: options.reuseAccount ? "" : "select_account" });
    });
  }
  disconnect() { this.token = ""; this.expiresAt = 0; try {localStorage.setItem(this.rememberedKey,"0");} catch { /* Storage may be unavailable. */ } }
  pick(kind: "folder" | "sheet" | "json", multiple = false): Promise<{id: string; name: string}[]> {
    return new Promise((resolve, reject) => {
      try {
        const google = sdk();
        const view = new google.picker.DocsView().setMimeTypes(kind === "folder" ? "application/vnd.google-apps.folder" : kind === "sheet" ? "application/vnd.google-apps.spreadsheet" : "application/json");
        if (kind === "folder") view.setIncludeFolders(true).setSelectFolderEnabled(true);
        const picker = new google.picker.PickerBuilder().setAppId(this.config.appId).setOAuthToken(this.accessToken()).setDeveloperKey(this.config.apiKey).setOrigin(window.location.origin).addView(view).setCallback(data => {
          if (data.action === "cancel") resolve([]);
          if (data.action === "picked") resolve(data.docs ?? []);
        });
        if (multiple) picker.enableFeature(google.picker.Feature.MULTISELECT_ENABLED);
        picker.build().setVisible(true);
      } catch (error) { reject(error); }
    });
  }
}
