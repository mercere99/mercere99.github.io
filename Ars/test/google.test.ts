import { describe, expect, it, vi } from "vitest";
import { GoogleDrive, type CreationAttempt } from "../src/google/api";
import { appendEvent, newStream } from "../src/campaign/events";
import { StreamReader } from "../src/google/poll";
import { buildCampaignWorkbook } from "../src/sheets/workbook";
import { newCampaign } from "../src/campaign/model";
import { readCampaign } from "../src/sheets/read";
import { CAMPAIGN_CONTRACT, SHEET_RANGES } from "../src/sheets/contract";

const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
const workbook={id:"workbook-123",ownedByMe:true,appProperties:{arsOperation:"operation-1"}};
describe("Google file operations",()=>{
  it("joins an existing campaign using its stable ID and calendar without creating or editing files",async()=>{
    const fetcher=vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply({namedRanges:[{name:SHEET_RANGES.campaign}]}))
      .mockResolvedValueOnce(reply({valueRanges:[{values:[
        ["Contract",CAMPAIGN_CONTRACT],["Campaign ID","shared-saga"],["Name","Shared saga"],
        ["Year",1235],["Season","Winter"],["Notes","A covenant in the mountains"],["Location","Provence"],["Default language","Occitan"],
      ]}]}));
    const campaign=await readCampaign(new GoogleDrive(()=>"token",fetcher),"campaign-sheet");
    expect(campaign).toMatchObject({id:"shared-saga",name:"Shared saga",year:1235,season:"Winter",location:"Provence",defaultLanguage:"Occitan",google:{indexId:"campaign-sheet"}});
    expect(fetcher.mock.calls).toHaveLength(2);
    expect(fetcher.mock.calls.every(([,init])=>!init?.method||init.method==="GET")).toBe(true);
  });
  it("uses the browser receiver for the default transport during account lookup",async()=>{
    const user={permissionId:"member-123",displayName:"Test member"};
    const fetcher=vi.fn(function(this:unknown,_input:RequestInfo|URL,init?:RequestInit){
      if(this!==globalThis)throw new TypeError("fetch called on an object that does not implement interface Window");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
      return Promise.resolve(reply({user}));
    });
    vi.stubGlobal("fetch",fetcher);
    try {
      expect(await new GoogleDrive(()=>"test-token").account()).toEqual({user});
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]![0]).toBe("https://www.googleapis.com/drive/v3/about?fields=user(permissionId,displayName)");
    } finally {vi.unstubAllGlobals();}
  });
  it("initializes once and returns the same workbook after an interrupted completion",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(reply({files:[]})).mockResolvedValueOnce(reply(workbook))
      .mockResolvedValueOnce(reply({sheets:[{properties:{sheetId:0,title:"Sheet1"}}]}))
      .mockResolvedValueOnce(reply({})).mockResolvedValueOnce(reply({}));
    const drive=new GoogleDrive(()=>"test-token",fetcher);
    let saved:CreationAttempt={operationId:"operation-1",state:"new"};
    const plan=buildCampaignWorkbook(newCampaign("Saga"));
    expect(await drive.createWorkbook(plan,saved,a=>{saved=a;})).toBe(workbook.id);
    expect(saved.state).toBe("complete");
    const batch=JSON.parse(String(fetcher.mock.calls[3]![1]!.body));
    expect(batch.requests.at(-1)).toEqual({deleteSheet:{sheetId:0}});
    fetcher.mockResolvedValueOnce(reply({files:[workbook]})).mockResolvedValueOnce(reply(workbook))
      .mockResolvedValueOnce(reply({sheets:[],namedRanges:[{name:"ars_campaign"}]}));
    await drive.createWorkbook(plan,saved,a=>{saved=a;});
    expect(fetcher.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(2);
  });
  it("does not duplicate a workbook when the create response is lost",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(reply({files:[]})).mockRejectedValueOnce(new Error("network lost"));
    const drive=new GoogleDrive(()=>"token",fetcher);
    let saved:CreationAttempt={operationId:"operation-1",state:"new"};
    const plan=buildCampaignWorkbook(newCampaign("Saga"));
    await expect(drive.createWorkbook(plan,saved,a=>{saved=a;})).rejects.toThrow("network lost");
    expect(saved.state).toBe("uncertain");
    fetcher.mockResolvedValueOnce(reply({files:[]}));
    await expect(drive.createWorkbook(plan,saved,a=>{saved=a;})).rejects.toThrow("will not create another copy");
    expect(fetcher.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
  });
  it("never initializes an established or another owner's workbook",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(reply({files:[{...workbook,ownedByMe:false}]}));
    await expect(new GoogleDrive(()=>"token",fetcher).createWorkbook(buildCampaignWorkbook(newCampaign("Saga")),{operationId:"operation-1",state:"new"},()=>{})).rejects.toThrow("only allowed");
    expect(fetcher.mock.calls).toHaveLength(1);
  });
  it("creates a setup folder inside the chosen parent",async()=>{
    const folder={id:"folder-123",mimeType:"application/vnd.google-apps.folder",ownedByMe:true,appProperties:{arsFolderOperation:"folder-op"}};
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(reply({files:[]})).mockResolvedValueOnce(reply(folder));
    await new GoogleDrive(()=>"token",fetcher).createFolderOnce("Records","chosen-parent",{operationId:"folder-op",state:"new"},()=>{});
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]!.body)).parents).toEqual(["chosen-parent"]);
  });
  it("reuses a setup folder after it is moved instead of duplicating or relocating it",async()=>{
    const folder={id:"folder-123",parents:["moved-parent"],mimeType:"application/vnd.google-apps.folder",ownedByMe:true,appProperties:{arsFolderOperation:"folder-op"}};
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(reply({files:[folder]}));
    const result=await new GoogleDrive(()=>"token",fetcher).createFolderOnce("Records","original-parent",{operationId:"folder-op",state:"uncertain"},()=>{});
    expect(result.id).toBe(folder.id);expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("requires the originating actor and session before writing events",async()=>{
    const stream=appendEvent(newStream("saga","alpha"),"probe",{});
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ownedByMe:false}));
    await expect(new GoogleDrive(()=>"token",fetcher).writeStream("event-file",stream)).rejects.toThrow("originating member");
    expect(fetcher.mock.calls).toHaveLength(1);
  });
  it("does not overwrite newer remote events when retrying an old outbox",async()=>{
    const pending=appendEvent(newStream("saga","alpha"),"probe",{a:1});
    const newer=appendEvent(pending,"probe",{a:2});
    const meta={id:"event-file",ownedByMe:true,appProperties:{arsCampaign:"saga",arsActor:"alpha",arsSession:pending.sessionId}};
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(reply(meta)).mockResolvedValueOnce(reply(newer));
    const acknowledged=await new GoogleDrive(()=>"token",fetcher).writeStream("event-file",pending);
    expect(acknowledged).toEqual(newer);
    expect(fetcher.mock.calls.every(([,init])=>!init?.method)).toBe(true);
  });
  it("reports expired authorization without automatically replaying writes",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(reply({error:{}},401));
    await expect(new GoogleDrive(()=>"token",fetcher).createFolder("Saga")).rejects.toThrow("Connect again");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reuses unchanged event bodies but refetches changed versions and preserves partial failures",async()=>{
    const stream=appendEvent(newStream("saga","alpha"),"probe",{});
    const file={id:"event-file",name:"Session",mimeType:"application/json",version:"1",appProperties:{arsKind:"stream",arsCampaign:"saga"}};
    const read=vi.fn().mockResolvedValue(stream);
    const get=vi.fn().mockImplementation(async(id:string)=>{if(id==="missing")throw new Error("Not shared");return file;});
    const drive={getFile:get,readStream:read,children:async()=>[]} as unknown as GoogleDrive;
    const reader=new StreamReader(drive,"saga");
    const a=await reader.refresh([],[file.id,"missing"]);expect(a.streams).toEqual([stream]);expect(a.errors).toEqual(["Not shared"]);
    await reader.refresh([],[file.id]);expect(read).toHaveBeenCalledTimes(1);
    file.version="2";await reader.refresh([],[file.id]);expect(read).toHaveBeenCalledTimes(2);
  });
});
