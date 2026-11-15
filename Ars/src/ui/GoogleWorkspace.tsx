import { useEffect, useMemo, useRef, useState } from "react";
import type { Character } from "../model/character";
import { appendEvent, mergeEvents, newStream, type EventStream, type SessionEvent } from "../campaign/events";
import type { Campaign, RecordReference } from "../campaign/model";
import { GoogleSession, configured } from "../google/auth";
import { GoogleDrive, type CreationAttempt } from "../google/api";
import { StreamReader } from "../google/poll";
import { pendingUploads, savePending, type PendingUpload } from "../google/outbox";
import { buildCampaignWorkbook, buildCharacterWorkbook } from "../sheets/workbook";
import { readCampaign, readCharacter } from "../sheets/read";
import type { CharacterSnapshot, WorkbookPlan } from "../sheets/contract";
import { definitiveEdition as rules } from "../data/ruleset";

const link = (id: string) => `https://drive.google.com/open?id=${encodeURIComponent(id)}`;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
function attemptFor(key: string): CreationAttempt {
  const previous = localStorage.getItem(key);
  return previous ? JSON.parse(previous) : {operationId:crypto.randomUUID(),state:"new"};
}
export function GoogleWorkspace({ session, campaign, character, onCampaign, onJoin }: {
  session: GoogleSession; campaign: Campaign; character?: Character;
  onCampaign: (campaign: Campaign) => void; onJoin: (campaign: Campaign) => void;
}) {
  const drive = useMemo(() => new GoogleDrive(session.accessToken), [session]);
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<{permissionId:string;displayName:string}>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [snapshot, setSnapshot] = useState<CharacterSnapshot>();
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [pollStatus, setPollStatus] = useState("Not connected");
  const [observed, setObserved] = useState("");
  const [pending, setPending] = useState(false);
  const [queued, setQueued] = useState<PendingUpload[]>([]);
  const publisher = useRef<{stream:EventStream;fileId?:string;pending?:EventStream}>();
  const publishing = useRef(false);
  const busyRef = useRef(false);
  useEffect(() => {
    let alive = true;
    if (configured(session.config)) session.prepare().then(() => {if(alive)setReady(true);}).catch(e=>{if(alive)setError(errorText(e));});
    if (session.connected) drive.account().then(r=>{if(alive)setAccount(r.user);}).catch(e=>{if(alive)setError(errorText(e));});
    return () => {alive=false;};
  },[session,drive]);
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current=true;setBusy(true);setError("");setNotice("");
    try { await action(); } catch(e) { setError(errorText(e)); }
    finally {busyRef.current=false;setBusy(false);}
  }
  const rootIds = JSON.stringify(campaign.google?.sharedFolderIds ?? []);
  const directIds = JSON.stringify(campaign.google?.selectedStreamIds ?? []);
  const writerId = campaign.google?.writerFolderId;
  const reader = useMemo(() => new StreamReader(drive,campaign.id),[drive,campaign.id,account?.permissionId]);
  useEffect(() => {
    publisher.current=undefined;setPending(false);setSnapshot(undefined);setEvents([]);
    try {setQueued(account?pendingUploads(localStorage,campaign.id,account.permissionId):[]);}
    catch(e) {setError(errorText(e));}
  },[account?.permissionId,campaign.id]);
  async function refreshEvents() {
    const folders = [...JSON.parse(rootIds) as string[], ...(writerId ? [writerId] : [])];
    const result = await reader.refresh(folders,JSON.parse(directIds));
    setEvents(mergeEvents(result.streams));setObserved(result.observedAt);
    setPollStatus(result.errors.length ? `Partial read: ${result.errors.join(" ")}` : "Connected · polling every few seconds");
    return result.errors.length;
  }
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function tick() {
      if (!alive || !account) return;
      if (!session.connected) {setPollStatus("Authorization expired · reconnect Google to resume updates");return;}
      if (!document.hidden) {
        try {
          const result = await reader.refresh([...JSON.parse(rootIds), ...(writerId ? [writerId] : [])],JSON.parse(directIds));
          if (!alive) return;
          setEvents(mergeEvents(result.streams));setObserved(result.observedAt);
          setPollStatus(result.errors.length ? `Partial read: ${result.errors.join(" ")}` : "Connected · polling every few seconds");
          failures = result.errors.length ? failures+1 : 0;
        } catch(e) {if(alive){setPollStatus(`Updates paused: ${errorText(e)}`);failures++;}}
      }
      if (alive) timer=setTimeout(tick,document.hidden?30000:Math.min(60000,5000*2**Math.min(failures,4)));
    }
    if(account) void tick();
    return () => {alive=false;clearTimeout(timer);};
  },[account,session,reader,rootIds,directIds,writerId]);
  function updateGoogle(patch: Partial<NonNullable<Campaign["google"]>>) {
    onCampaign({...campaign,google:{indexId:"",sharedFolderIds:[],selectedStreamIds:[],...campaign.google,...patch}});
  }
  async function create(plan: WorkbookPlan, key: string, folder?: string) {
    const action=()=>drive.createWorkbook(plan,attemptFor(key),value=>localStorage.setItem(key,JSON.stringify(value)),folder);
    return navigator.locks?navigator.locks.request(key,action):action();
  }
  async function folder(name:string, purpose:string, parent?:string) {
    const key=`ars:folder:${campaign.id}:${account?.permissionId}:${purpose}`;
    const action=()=>drive.createFolderOnce(name,parent,attemptFor(key),value=>localStorage.setItem(key,JSON.stringify(value)));
    return navigator.locks?navigator.locks.request(key,action):action();
  }
  async function publish(type: SessionEvent["type"], payload: SessionEvent["payload"]) {
    if (publishing.current) throw new Error("Wait for the current event to finish sharing.");
    if (!account || !writerId) throw new Error("Choose your own writable session folder first.");
    publishing.current=true;
    try {
      if (!publisher.current) publisher.current={stream:newStream(campaign.id,account.permissionId)};
      const p=publisher.current;
      if (!p.pending) p.pending=appendEvent(p.stream,type,payload,events);
      const key=`ars:pending:${campaign.id}:${account.permissionId}:${p.pending.sessionId}`;
      const save=()=>savePending(localStorage,p.pending!,writerId,p.fileId);
      save();setPending(true);
      if (!p.fileId) {p.fileId=(await drive.createStream(p.pending,writerId)).id;save();}
      p.stream=await drive.writeStream(p.fileId,p.pending);
      p.pending=undefined;localStorage.removeItem(key);setPending(false);
      await refreshEvents();
    } finally {publishing.current=false;}
  }
  async function recover(upload: PendingUpload) {
    if(!account || account.permissionId!==upload.stream.actorId) throw new Error("Reconnect as the original member to retry this upload.");
    if(!navigator.locks)throw new Error("Queued recovery needs a browser with Web Locks support to coordinate safely with other open tabs.");
    const id=upload.fileId ?? (await drive.createStream(upload.stream,upload.folderId)).id;
    savePending(localStorage,upload.stream,upload.folderId,id);
    await drive.writeStream(id,upload.stream);
    localStorage.removeItem(upload.key);
    setQueued(pendingUploads(localStorage,campaign.id,account.permissionId));
    await refreshEvents();setNotice("Queued event history is shared. Its original event IDs were retained.");
  }
  async function register(record: RecordReference) {
    const records=[...campaign.records.filter(r=>r.id!==record.id),record];
    onCampaign({...campaign,records});
    if (account && writerId) await publish("register-record",{record});
    else setNotice("File registered on this device. Choose a session folder to publish shared registrations.");
  }
  async function initializeCampaign() {
    const parent=campaign.google?.creationFolder?.id;
    const recordsFolder=campaign.google?.recordsFolderId ?? (await folder(`${campaign.name} — records`,"records",parent)).id;
    const indexId=await create(buildCampaignWorkbook(campaign),`ars:create:campaign:${campaign.id}`,recordsFolder);
    // State folders stay OUTSIDE the broadly editable campaign-record folder.
    const root=campaign.google?.sharedFolderIds[0] ?? (await folder(`${campaign.name} — app state`,"state",parent)).id;
    const writer=campaign.google?.writerFolderId ?? (await folder(`${account?.displayName ?? "My"} sessions`,"writer",root)).id;
    onCampaign({...campaign,google:{...campaign.google,indexId,recordsFolderId:recordsFolder,writerFolderId:writer,sharedFolderIds:[root],selectedStreamIds:[]}});
    setNotice("Created campaign files. They inherit their parent folder's sharing. Use Drive to share records as editors and app state as viewers; provision another member's writable session folder separately.");
  }
  const registered = events.filter(e=>e.type==="register-record").map(e=>e.payload.record as RecordReference).filter(r=>r?.kind==="character" && typeof r.fileId==="string" && typeof r.id==="string" && typeof r.label==="string");
  const records=[...new Map([...campaign.records,...registered].map(r=>[r.fileId,r])).values()];
  const connected=!!account && session.connected;
  return <section className="google-workspace" aria-label="Google campaign workspace">
    <header className="section-heading"><h2>Google campaign workspace</h2><span className="help">{connected?`Connected as ${account.displayName}`:"Local mode"}</span></header>
    {!configured(session.config) && <p>Google connection is not configured yet. Campaign setup and character creation work in this browser. Follow <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud setup</a> and the project's <code>docs/GOOGLE_SETUP.md</code> instructions to enable sharing.</p>}
    <div className="toolbar">
      <button className="btn" disabled={!ready||busy} onClick={()=>void run(async()=>{await session.authorize();const result=await drive.account();setAccount(result.user);setNotice("Connected. Select only the campaign files you want this app to access.");})}>{connected?"Reconnect Google":"Connect Google"}</button>
      {!ready && configured(session.config) && <button className="btn" disabled={busy} onClick={()=>void run(async()=>{await session.prepare();setReady(true);})}>Retry loading Google connection</button>}
      {connected && <button className="btn" disabled={busy} onClick={()=>{session.disconnect();setAccount(undefined);setEvents([]);setSnapshot(undefined);setPollStatus("Disconnected");}}>Disconnect</button>}
    </div>
    {!campaign.google?.indexId && <>
      <p className="help">Location for new campaign folders: {campaign.google?.creationFolder ? <a href={link(campaign.google.creationFolder.id)} target="_blank" rel="noreferrer">{campaign.google.creationFolder.name}</a> : "My Drive (top level)"}. The records and app-state folders inherit this location's sharing.</p>
      <div className="toolbar">
        <button className="btn" disabled={!connected||busy} onClick={()=>void run(async()=>{const selected=await session.pick("folder");if(selected[0])updateGoogle({creationFolder:{id:selected[0].id,name:selected[0].name}});})}>Choose location for new campaign folders</button>
        {campaign.google?.creationFolder && <button className="btn" disabled={!connected||busy} onClick={()=>updateGoogle({creationFolder:undefined})}>Use My Drive top level</button>}
      </div>
    </>}
    <div className="toolbar">
      <button className="btn" disabled={!connected||busy||!!campaign.google?.indexId} onClick={()=>void run(initializeCampaign)}>Create campaign files</button>
      <button className="btn" disabled={!connected||busy} onClick={()=>void run(async()=>{const selected=await session.pick("sheet");if(selected[0])onJoin(await readCampaign(drive,selected[0].id));})}>Open campaign Sheet</button>
    </div>
    {campaign.google?.indexId && <p><a href={link(campaign.google.indexId)} target="_blank" rel="noreferrer">Open campaign calendar</a>{" · "}<button className="btn bare small" disabled={!connected||busy} onClick={()=>void run(async()=>{const fresh=await readCampaign(drive,campaign.google!.indexId);if(fresh.id!==campaign.id)throw new Error("Campaign ID changed in the Sheet.");onCampaign({...campaign,name:fresh.name,year:fresh.year,season:fresh.season,notes:fresh.notes,location:fresh.location,defaultLanguage:fresh.defaultLanguage});setNotice("Read the campaign calendar and defaults from Sheets.");})}>Refresh calendar</button></p>}
    {campaign.google?.recordsFolderId && <p><a href={link(campaign.google.recordsFolderId)} target="_blank" rel="noreferrer">Campaign records folder</a></p>}
    {campaign.google?.sharedFolderIds.map(id=><p key={id}><a href={link(id)} target="_blank" rel="noreferrer">Shared app-state folder</a></p>)}
    <div className="toolbar">
      <button className="btn" disabled={!connected||busy} onClick={()=>void run(async()=>{const selected=await session.pick("folder");if(selected[0])updateGoogle({recordsFolderId:selected[0].id});})}>Choose campaign records folder</button>
      <button className="btn" disabled={!connected||busy} onClick={()=>void run(async()=>{const selected=await session.pick("folder");if(selected[0])updateGoogle({writerFolderId:selected[0].id});})}>Choose my writable session folder</button>
      <button className="btn" disabled={!connected||busy} onClick={()=>void run(async()=>{const selected=await session.pick("folder",true);if(selected.length)updateGoogle({sharedFolderIds:[...new Set([...(campaign.google?.sharedFolderIds??[]),...selected.map(f=>f.id)])]});})}>Add shared session folder</button>
      <button className="btn" disabled={!connected||busy} onClick={()=>void run(async()=>{const selected=await session.pick("json",true);if(selected.length)updateGoogle({selectedStreamIds:[...new Set([...(campaign.google?.selectedStreamIds??[]),...selected.map(f=>f.id)])]});})}>Authorize individual event files</button>
    </div>
    {writerId && <p className="help">Your session files go into <a href={link(writerId)} target="_blank" rel="noreferrer">your selected folder</a>. Each browser session writes a different file. Drive sharing and app access must both allow the other member to read it.</p>}
    <div className="toolbar">
      <button className="btn" disabled={!connected||busy||!writerId||pending} onClick={()=>void run(async()=>{await publish("probe",{message:"Connection test",sentAt:new Date().toISOString()});setNotice("Test event shared. Check the second account's event history.");})}>Publish test event</button>
      {pending && <button className="btn primary" disabled={!connected||busy} onClick={()=>void run(async()=>{await publish("probe",{});})}>Retry pending event</button>}
      <button className="btn" disabled={!connected||busy} onClick={()=>void run(async()=>{await refreshEvents();})}>Refresh events</button>
    </div>
    <p className="help" role="status">{busy?"Working…":pending?"Event saved locally; sharing pending":pollStatus}{observed?` · last checked ${new Date(observed).toLocaleTimeString()}`:""}</p>
    {queued.map(upload=><p key={upload.key}>Queued from an earlier session ({upload.stream.events.length} retained events). <button className="btn small" disabled={!connected||busy||pending} onClick={()=>void run(()=>recover(upload))}>Retry queued upload</button></p>)}
    {events.length>0 && <details><summary>Session event history ({events.length})</summary><ol className="session-events">{events.slice(-30).map(e=><li key={e.id}>{e.type} · {e.actorId===account?.permissionId?"you":e.actorId.slice(0,10)} · {new Date(e.createdAt).toLocaleTimeString()} <span className="help">{e.id.slice(0,8)}</span></li>)}</ol></details>}
    <hr />
    <div className="toolbar">
      <button className="btn" disabled={!connected||busy||!character||character.type==="magus"||!campaign.google?.indexId||!campaign.google?.recordsFolderId||pending} onClick={()=>void run(async()=>{
        if(!character)return;
        const id=await create(buildCharacterWorkbook(character,rules,campaign),`ars:create:character:${campaign.id}:${character.id}`,campaign.google?.recordsFolderId);
        await register({id:character.id,fileId:id,label:character.name||"Unnamed character",kind:"character"});
        setNotice("Character Sheet created. Allow access to the campaign calendar in Sheets if prompted. Ongoing edits belong in that Sheet.");
        setSnapshot(await readCharacter(drive,id));
      })}>Create Sheet for this character</button>
      <button className="btn" disabled={!connected||busy||pending} onClick={()=>void run(async()=>{const selected=await session.pick("sheet");if(selected[0]){const value=await readCharacter(drive,selected[0].id);if(value.campaignId&&value.campaignId!==campaign.id)throw new Error("This character belongs to a different campaign.");setSnapshot(value);await register({id:value.id,fileId:value.fileId,label:value.name,kind:"character"});}})}>Read an existing character Sheet</button>
    </div>
    {!character && <p className="help">Open a companion or grog draft to create its Google Sheet.</p>}
    {campaign.google?.indexId && !campaign.google.recordsFolderId && <p className="help">Choose the shared campaign records folder before creating a character Sheet, so it inherits the troupe's editing access.</p>}
    {records.length>0 && <ul className="linked-records">{records.map(record=><li key={record.fileId}><a href={link(record.fileId)} target="_blank" rel="noreferrer">{record.label}</a>{" "}<button className="btn bare small" disabled={!connected||busy} onClick={()=>void run(async()=>{setSnapshot(await readCharacter(drive,record.fileId));})}>Read current values</button></li>)}</ul>}
    {snapshot && <article className="linked-snapshot"><h3>{snapshot.name} · age {snapshot.age}</h3><p className="help">Read from Sheets {new Date(snapshot.fetchedAt).toLocaleTimeString()}. Permanent changes are made directly in the Sheet.</p><table><thead><tr><th>Ability</th><th>Score</th><th>XP</th><th>Surplus</th><th>To next</th></tr></thead><tbody>{snapshot.abilities.map(a=><tr key={a.key}><td>{a.name}{a.subject?` — ${a.subject}`:""}{a.specialty?` (${a.specialty})`:""}</td><td>{a.effective}</td><td>{a.xp}</td><td>{a.surplus}</td><td>{a.next}</td></tr>)}</tbody></table></article>}
    {notice && <p className="ok" role="status">{notice}</p>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
  </section>;
}
