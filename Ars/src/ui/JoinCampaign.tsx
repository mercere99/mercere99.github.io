import { useEffect, useMemo, useRef, useState } from "react";
import type { Campaign } from "../campaign/model";
import { configured, type GoogleSession } from "../google/auth";
import { GoogleDrive } from "../google/api";
import { readCampaign } from "../sheets/read";

export function JoinCampaign({ session, onJoin, onCancel }: {
  session: GoogleSession; onJoin: (campaign: Campaign) => void; onCancel: () => void;
}) {
  const drive = useMemo(() => new GoogleDrive(session.accessToken), [session]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(session.connected);
  const [error, setError] = useState("");
  const running = useRef(false);
  async function prepare() { await session.prepare(); setReady(true); }
  useEffect(() => {
    let alive = true;
    if (configured(session.config)) session.prepare().then(() => {if(alive)setReady(true);}).catch(e => {if(alive)setError(String(e instanceof Error ? e.message : e));});
    return () => {alive=false;};
  }, [session]);
  async function run(action: () => Promise<void>) {
    if(running.current)return;
    running.current=true;setBusy(true);setError("");
    try {await action();}
    catch(e) {setError(e instanceof Error ? e.message : String(e));}
    finally {running.current=false;setBusy(false);setConnected(session.connected);}
  }
  return <section className="campaign-action" aria-label="Join campaign">
    <h2>Join campaign</h2>
    <p>Ask another member to share the campaign records folder with your Google account. Connect Google, then choose the campaign calendar Sheet.</p>
    {!configured(session.config) && <p className="help">This copy of the app needs Google connection setup before you can join a shared campaign.</p>}
    <div className="toolbar">
      <button className="btn" disabled={!ready||busy} onClick={()=>void run(async()=>{await session.authorize();})}>{connected?"Reconnect Google":"Connect Google"}</button>
      {!ready && configured(session.config) && <button className="btn" disabled={busy} onClick={()=>void run(prepare)}>Retry loading Google connection</button>}
      <button className="btn primary" disabled={!ready||!connected||busy} onClick={()=>void run(async()=>{
        const selected=await session.pick("sheet");
        if(selected[0])onJoin(await readCampaign(drive,selected[0].id));
      })}>Choose campaign Sheet</button>
      <button className="btn" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
    <p className="help">Joining adds the existing campaign to this browser. It does not create files or change Drive sharing. Select the shared records and session folders in the campaign workspace afterward.</p>
    {busy && <p role="status">Working…</p>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
  </section>;
}
