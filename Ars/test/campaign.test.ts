import { describe, expect, it } from "vitest";
import { appendEvent, mergeEvents, newStream, parseStream } from "../src/campaign/events";
import { newCampaign } from "../src/campaign/model";
import { pendingUploads, savePending } from "../src/google/outbox";
import { removeCampaignLocally } from "../src/campaign/storage";
import { newCharacter } from "../src/model/character";

function memoryStorage(): Storage {
  const data=new Map<string,string>();
  return {get length(){return data.size;},key:i=>[...data.keys()][i]??null,getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v);},removeItem:k=>{data.delete(k);},clear:()=>data.clear()};
}
describe("campaign sessions",()=>{
  it("removes only the selected browser campaign and retains its drafts and unrelated campaigns",()=>{
    const a=newCampaign("A"),b=newCampaign("B");
    a.google={indexId:"campaign-sheet",recordsFolderId:"records-folder",sharedFolderIds:["state-folder"],selectedStreamIds:[]};
    const c={...newCharacter("companion","definitive"),campaignId:a.id};
    const other={...newCharacter("grog","definitive"),campaignId:b.id};
    const next=removeCampaignLocally([a,b],[c,other],a.id);
    expect(next.campaigns).toEqual([b]);expect(next.roster).toEqual([{...c,campaignId:undefined},other]);
    expect(c.campaignId).toBe(a.id);expect(a.google.indexId).toBe("campaign-sheet");
    expect(next.roster[1]).toBe(other);
  });
  it("gives campaigns independent IDs, calendars, and optional records",()=>{
    const a=newCampaign("A",1230), b=newCampaign("B");
    expect(a.id).not.toBe(b.id);expect(b.year).toBe(1220);
    a.records.push({id:"c",fileId:"file",kind:"character",label:"Shared grog"});
    expect(b.records).toEqual([]);
  });
  it("converges after independent and causally ordered events regardless of delivery order or wall clock",()=>{
    const a=appendEvent(newStream("saga","alpha"),"probe",{message:"A"});
    const b=appendEvent(newStream("saga","beta"),"probe",{message:"B"});
    b.events[0]!.createdAt="1999-01-01T00:00:00Z";
    const c=appendEvent(a,"probe",{message:"C"},b.events);
    expect(c.events[1]!.logicalTime).toBe(2);
    const expected=mergeEvents([c,b]);
    expect(mergeEvents([b,c,b])).toEqual(expected);
    expect(expected.map(e=>e.payload.message)).toEqual(["A","B","C"]);
  });
  it("keeps separate streams for two tabs of the same member",()=>{
    expect(newStream("saga","alpha").sessionId).not.toBe(newStream("saga","alpha").sessionId);
  });
  it("rejects foreign ownership, malformed histories, and conflicting IDs",()=>{
    const a=appendEvent(newStream("saga","alpha"),"probe",{});
    expect(()=>parseStream(a,"other")).toThrow("campaign");
    expect(()=>parseStream({...a,actorId:"beta"},"saga")).toThrow("Invalid");
    expect(()=>parseStream({...a,events:[...a.events,...a.events]},"saga")).toThrow("Invalid");
    const b={...a,events:[{...a.events[0]!,payload:{different:true}}]};
    expect(()=>mergeEvents([a,b])).toThrow("same ID");
  });
  it("recovers the original queued event and destination after a reload, isolated by account and campaign",()=>{
    const storage=memoryStorage();
    const stream=appendEvent(newStream("saga","alpha"),"probe",{result:7});
    const key=savePending(storage,stream,"writer-folder","event-file");
    expect(pendingUploads(storage,"saga","alpha")).toEqual([{key,stream,folderId:"writer-folder",fileId:"event-file"}]);
    expect(pendingUploads(storage,"saga","beta")).toEqual([]);
    expect(pendingUploads(storage,"other","alpha")).toEqual([]);
    storage.removeItem(key);expect(pendingUploads(storage,"saga","alpha")).toEqual([]);
  });
});
