import { useEffect, useMemo, useRef, useState } from "react";
import { definitiveEdition as rules } from "./data/ruleset";
import { touch, type Character } from "./model/character";
import { createCharacter } from "./engine/create";
import { generateGrog, ARCHETYPES } from "./engine/generate";
import { validate } from "./engine/validate";
import { exportJson, importJson, loadCampaignYear, saveCampaignYear, loadRoster, saveRoster } from "./storage/persist";
import { Workbench } from "./ui/Workbench";
import { Sheet } from "./ui/Sheet";
import { newCampaign, SEASONS, type Campaign } from "./campaign/model";
import { loadActiveCampaign, loadCampaigns, removeCampaignLocally, saveActiveCampaign, saveCampaigns } from "./campaign/storage";
import { configured, GoogleSession, googleConfig } from "./google/auth";
import { GoogleWorkspace } from "./ui/GoogleWorkspace";
import { JoinCampaign } from "./ui/JoinCampaign";

type View = { kind: "roster" } | { kind: "edit"; id: string };

export function App() {
  const [roster, setRoster] = useState<Character[]>(() => loadRoster());
  const [draftYear, setDraftYear] = useState(loadCampaignYear);
  const [campaigns, setCampaigns] = useState(loadCampaigns);
  const [activeCampaignId, setActiveCampaignId] = useState(loadActiveCampaign);
  const [campaignName, setCampaignName] = useState("");
  const [campaignLocation, setCampaignLocation] = useState("");
  const [campaignLanguage, setCampaignLanguage] = useState("");
  const [campaignAction, setCampaignAction] = useState<"create" | "join" | "delete">();
  const [googleSession] = useState(() => new GoogleSession(googleConfig(),campaigns.some(c=>!!c.google?.indexId)));
  const [googleReady, setGoogleReady] = useState(false);
  const [googleRevision,setGoogleRevision] = useState(0);
  const [googleMessage,setGoogleMessage] = useState("");
  const [view, setView] = useState<View>({ kind: "roster" });
  const [archetype, setArchetype] = useState<string>("");
  const fileInput = useRef<HTMLInputElement>(null);
  const activeCampaign = campaigns.find(c => c.id === activeCampaignId);
  const campaignYear = activeCampaign?.year ?? draftYear;
  function updateCampaign(value: Campaign) {
    setCampaigns(previous => previous.some(c => c.id === value.id) ? previous.map(c => c.id === value.id ? value : c) : [...previous,value]);
  }
  function setCampaignYear(year: number) {
    if (activeCampaign) updateCampaign({...activeCampaign,year});
    else setDraftYear(year);
  }
  function selectCampaign(id: string) { setActiveCampaignId(id);setView({kind:"roster"});setCampaignAction(undefined); }
  function reconnectForSelection() {
    if(googleSession.connected||!googleSession.previouslyAuthorized)return;
    if(!googleReady){setGoogleMessage("Google connection is loading. Use Connect Google when it is ready.");return;}
    setGoogleMessage("Connecting Google…");
    // Invoke directly during the selection gesture so browsers can open OAuth.
    void googleSession.authorize({reuseAccount:true}).then(()=>{setGoogleRevision(n=>n+1);setGoogleMessage("Google connected.");})
      .catch(e=>setGoogleMessage(`${e instanceof Error?e.message:String(e)} Use Connect Google to retry.`));
  }
  function campaignSelection(value: string) {
    setGoogleMessage("");
    if(value==="create"||value==="delete")setCampaignAction(value);
    else if(value==="join"){setCampaignAction("join");reconnectForSelection();}
    else {selectCampaign(value);if(campaigns.find(c=>c.id===value)?.google?.indexId)reconnectForSelection();}
  }
  function joinCampaign(c: Campaign) {
    setCampaigns(previous => {
      const saved=previous.find(p=>p.id===c.id);
      const joined=saved?{...saved,name:c.name,year:c.year,season:c.season,notes:c.notes,location:c.location,defaultLanguage:c.defaultLanguage,google:{...c.google!,...saved.google,indexId:c.google!.indexId}}:c;
      return saved?previous.map(p=>p.id===c.id?joined:p):[...previous,joined];
    });
    selectCampaign(c.id);
  }

  useEffect(() => saveRoster(roster), [roster]);
  useEffect(() => saveCampaignYear(draftYear), [draftYear]);
  useEffect(() => saveCampaigns(campaigns), [campaigns]);
  useEffect(() => saveActiveCampaign(activeCampaignId), [activeCampaignId]);
  useEffect(()=>{
    let alive=true;
    if(configured(googleSession.config))void googleSession.prepare().then(()=>{if(alive)setGoogleReady(true);}).catch(()=>{});
    return ()=>{alive=false;};
  },[googleSession]);

  const current = view.kind === "edit" ? roster.find((c) => c.id === view.id) : undefined;

  function upsert(c: Character) {
    setRoster((r) => (r.some((x) => x.id === c.id) ? r.map((x) => (x.id === c.id ? c : x)) : [...r, c]));
  }
  function open(c: Character) {
    upsert(c);
    setView({ kind: "edit", id: c.id });
  }
  function remove(id: string) {
    setRoster((r) => r.filter((c) => c.id !== id));
    if (view.kind === "edit" && view.id === id) setView({ kind: "roster" });
  }

  return (
    <div className="app">
      <header className="masthead">
        <h1>
          Ars Ratiocinandi<small>for Ars Magica</small>
        </h1>
        <label className="campaign-switcher">Campaign
          <select aria-label="Campaign" value={activeCampaign?.id ?? ""} onChange={e=>campaignSelection(e.target.value)}>
            <option value="">Local drafts</option>
            {campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            <optgroup label="Campaign actions">
              <option value="create">Create campaign…</option>
              <option value="join">Join campaign…</option>
              <option value="delete" disabled={!activeCampaign}>Delete current campaign…</option>
            </optgroup>
          </select>
        </label>
        <label className="campaign-year">Campaign year
          <input aria-label="Campaign year" type="number" min={1} max={9999} value={campaignYear} disabled={!!activeCampaign?.google?.indexId}
            onChange={(e) => {
              const year = e.target.valueAsNumber;
              if (Number.isInteger(year) && year > 0 && year < 10000) setCampaignYear(year);
            }} />
        </label>
        <nav>
          <button className="btn" onClick={() => setView({ kind: "roster" })} disabled={view.kind === "roster"}>
            {view.kind==="edit"?"← Back to campaign":"Campaign roster"}
          </button>
          {current && (
            <>
              <button className="btn" onClick={() => exportJson(current)}>Export JSON</button>
              <button className="btn" onClick={() => window.print()}>Print sheet</button>
            </>
          )}
          <button className="btn" onClick={() => fileInput.current?.click()}>Import JSON</button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const c = await importJson(f);
                open({ ...c, id: crypto.randomUUID(), campaignId: activeCampaign?.id });
              } catch (err) {
                alert(`Could not import: ${(err as Error).message}`);
              }
              e.target.value = "";
            }}
          />
        </nav>
      </header>
      {googleMessage && <p className="connection-notice" role="status">{googleMessage}</p>}

      {campaignAction==="create" && <section className="campaign-action" aria-label="Create campaign">
        <h2>Create campaign</h2>
        <form className="toolbar" onSubmit={e=>{
          e.preventDefault();if(!campaignName.trim())return;
          const c={...newCampaign(campaignName),location:campaignLocation.trim(),defaultLanguage:campaignLanguage.trim()};
          updateCampaign(c);setCampaignName("");setCampaignLocation("");setCampaignLanguage("");selectCampaign(c.id);
        }}>
          <input aria-label="New campaign name" value={campaignName} onChange={e=>setCampaignName(e.target.value)} placeholder="Campaign name" required autoFocus />
          <input aria-label="New campaign location" value={campaignLocation} onChange={e=>setCampaignLocation(e.target.value)} placeholder="Location (optional)" />
          <input aria-label="New campaign default language" value={campaignLanguage} onChange={e=>setCampaignLanguage(e.target.value)} placeholder="Default language (optional)" />
          <button className="btn primary" type="submit" disabled={!campaignName.trim()}>Create campaign</button>
          <button className="btn" type="button" onClick={()=>setCampaignAction(undefined)}>Cancel</button>
        </form>
        <p className="help">The campaign is saved in this browser. Connect Google and create its shared files in the campaign workspace when you are ready.</p>
      </section>}
      {campaignAction==="join" && <JoinCampaign key={googleRevision} session={googleSession} onJoin={joinCampaign} onCancel={()=>setCampaignAction(undefined)} />}
      {campaignAction==="delete" && activeCampaign && <section className="campaign-action" aria-label="Delete campaign">
        <h2>Delete {activeCampaign.name} from this browser?</h2>
        <p>This removes the saved campaign and its links from this browser. Character drafts are kept under Local drafts. Google Drive files and other players' copies are unchanged.</p>
        <div className="toolbar">
          <button className="btn primary" onClick={()=>{
            const id=activeCampaign.id;
            const next=removeCampaignLocally(campaigns,roster,id);
            setCampaigns(next.campaigns);setRoster(next.roster);
            selectCampaign("");
            alert("Campaign removed from this browser. Its Google Drive files have not been deleted. To remove them too, open Google Drive and move the campaign's records and app-state folders to Trash separately. Your character drafts remain under Local drafts.");
          }}>Delete from this browser</button>
          <button className="btn" onClick={()=>setCampaignAction(undefined)} autoFocus>Cancel</button>
        </div>
      </section>}

      {!campaignAction && activeCampaign && <details className="cloud-panel"><summary>Google Sheets & shared session prototype{activeCampaign.google?.indexId?" · campaign linked":""}</summary>
        <GoogleWorkspace key={`${activeCampaign.id}:${googleRevision}`} session={googleSession} campaign={activeCampaign} character={current}
          onCampaign={updateCampaign} onJoin={joinCampaign} />
      </details>}

      {view.kind === "roster" || !current ? (
        <Roster
          roster={roster.filter(c=>c.campaignId===activeCampaign?.id)}
          archetype={archetype}
          onArchetype={setArchetype}
          campaignYear={campaignYear}
          onNew={(type) => open(createCharacter(type,rules,campaignYear,activeCampaign))}
          onGenerate={() => open({...generateGrog(rules, { archetype: archetype || undefined, campaignYear,defaultLanguage:activeCampaign?.defaultLanguage,location:activeCampaign?.location }),campaignId:activeCampaign?.id})}
          campaignHeader={<section className="campaign-home" aria-label="Campaign setup">
            <h2>{activeCampaign?.name ?? "Your troupe"}</h2>
            {activeCampaign && <p>{activeCampaign.google?.indexId?"Calendar is read from Google Sheets. Use Refresh calendar above after editing it.":"Saved in this browser. Connect Google and create campaign files to share it with your troupe."}</p>}
            {activeCampaign && <label>Season <select aria-label="Season" disabled={!!activeCampaign.google?.indexId} value={activeCampaign.season} onChange={e=>updateCampaign({...activeCampaign,season:e.target.value as Campaign["season"]})}>{SEASONS.map(s=><option key={s}>{s}</option>)}</select></label>}
            {activeCampaign && <div className="campaign-defaults">
              <label>Location <input aria-label="Campaign location" value={activeCampaign.location??""} disabled={!!activeCampaign.google?.indexId} placeholder="e.g. Provence" onChange={e=>updateCampaign({...activeCampaign,location:e.target.value})} /></label>
              <label>Default language <input aria-label="Campaign default language" value={activeCampaign.defaultLanguage??""} disabled={!!activeCampaign.google?.indexId} placeholder="e.g. Occitan" onChange={e=>updateCampaign({...activeCampaign,defaultLanguage:e.target.value})} /></label>
              <p className="help">New characters use these as starting assumptions; existing characters keep their own language and Area Lore.</p>
              {activeCampaign.google?.indexId && <p className="help">Edit these defaults in the campaign Sheet, then use Refresh calendar. In an older Sheet, enter Location in A9 and Default language in A10, with their values in B9 and B10.</p>}
            </div>}
          </section>}
          onOpen={(c) => setView({ kind: "edit", id: c.id })}
          onRemove={remove}
        />
      ) : (
        <Editor character={current} campaignYear={campaignYear} onChange={(c) => upsert(touch(c))} onClose={()=>setView({kind:"roster"})} />
      )}
    </div>
  );
}

function Editor({ character, campaignYear, onChange, onClose }: { character: Character; campaignYear: number; onChange: (c: Character) => void; onClose:()=>void }) {
  const validation = useMemo(() => validate(character, rules, campaignYear), [character, campaignYear]);
  return (
    <div className="desk">
      <section className="workbench" aria-label="Workbench">
        <Workbench key={character.id} character={character} campaignYear={campaignYear} rules={rules} validation={validation} onChange={onChange} />
      </section>
      <section className="faircopy" aria-label="Character sheet">
        <button className="btn editor-close" onClick={onClose} aria-label="Close character and return to campaign" title="Changes are saved automatically in this browser">× Back to campaign</button>
        <Sheet character={character} rules={rules} validation={validation} />
      </section>
    </div>
  );
}

function Roster(props: {
  campaignHeader: React.ReactNode;
  roster: Character[];
  archetype: string;
  campaignYear: number;
  onArchetype: (a: string) => void;
  onNew: (type: Character["type"]) => void;
  onGenerate: () => void;
  onOpen: (c: Character) => void;
  onRemove: (id: string) => void;
}) {
  const rows = props.roster.map((c) => ({ c, v: validate(c, rules, props.campaignYear) }));
  return (
    <main className="roster">
      {props.campaignHeader}
      <div className="toolbar">
        <button className="btn primary" onClick={() => props.onNew("companion")}>New companion</button>
        <button className="btn" onClick={() => props.onNew("grog")}>New grog</button>
        <button className="btn" onClick={props.onGenerate}>Generate a grog</button>
        <select value={props.archetype} onChange={(e) => props.onArchetype(e.target.value)} aria-label="Archetype">
          <option value="">any archetype</option>
          {ARCHETYPES.map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </select>
      </div>
      {rows.length === 0 ? (
        <p className="empty">Start a companion or grog, or generate a grog for your troupe.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Kind</th><th>Concept</th><th className="num">Age</th><th>Virtues &amp; Flaws</th><th className="num">Problems</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, v }) => (
              <tr key={c.id}>
                <td><a href="#" onClick={(e) => { e.preventDefault(); props.onOpen(c); }}>{c.name || <i>unnamed</i>}</a></td>
                <td>{rules.characterTypes[c.type].label}</td>
                <td>{c.concept}</td>
                <td className="num">{v.resolved.age}</td>
                <td>{v.resolved.virtuePoints}/{v.resolved.flawPoints}</td>
                <td className="num">
                  {v.counts.error > 0 ? <span style={{ color: "var(--madder)" }}>{v.counts.error}</span> : <span className="ok">none</span>}
                  {v.counts.overridden > 0 && <span className="help"> · {v.counts.overridden} accepted</span>}
                </td>
                <td>
                  <button className="btn bare small" onClick={() => { if (confirm(`Remove ${c.name || "this character"}?`)) props.onRemove(c.id); }}>remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
