import { afterEach, describe, expect, it, vi } from "vitest";
import { DRIVE_SCOPE, GoogleSession } from "../src/google/auth";

const config={clientId:"test-client",apiKey:"test-key",appId:"123"};
function setup(response:Record<string,unknown>={access_token:"temporary-test-token",expires_in:3600,scope:DRIVE_SCOPE}){
  const saved=new Map<string,string>();
  vi.stubGlobal("localStorage",{getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>saved.set(key,value),removeItem:(key:string)=>saved.delete(key)});
  let callback:(value:Record<string,unknown>)=>void=()=>{};
  const request=vi.fn(()=>callback(response));
  vi.stubGlobal("window",{google:{accounts:{oauth2:{initTokenClient:(options:{callback:typeof callback})=>{callback=options.callback;return{requestAccessToken:request};}}}}});
  return {saved,request};
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe("remembering Google authorization",()=>{
  it("remembers only a reconnect preference across page sessions, never the access token",async()=>{
    const {saved,request}=setup();
    const first=new GoogleSession(config);
    expect(first.previouslyAuthorized).toBe(false);
    await first.authorize();
    expect(first.connected).toBe(true);
    expect([...saved.values()]).toEqual(["1"]);
    const reopened=new GoogleSession(config);
    expect(reopened.previouslyAuthorized).toBe(true);expect(reopened.connected).toBe(false);
    await reopened.authorize({reuseAccount:true});
    expect(request.mock.calls).toEqual([[{prompt:"select_account"}],[{prompt:""}]]);
    reopened.disconnect();expect(reopened.previouslyAuthorized).toBe(false);expect(reopened.connected).toBe(false);
  });
  it("requires a new token after expiry and never remembers rejected access",async()=>{
    vi.useFakeTimers();setup();
    const session=new GoogleSession(config);await session.authorize();
    vi.advanceTimersByTime(3600*1000);
    expect(session.connected).toBe(false);expect(session.previouslyAuthorized).toBe(true);
    const {saved}=setup({error:"access_denied"});
    await expect(new GoogleSession(config).authorize()).rejects.toThrow("access_denied");
    expect(saved.size).toBe(0);
  });
  it("recognizes an existing linked campaign but honors an explicit Disconnect on later visits",()=>{
    setup();
    const session=new GoogleSession(config,true);
    expect(session.previouslyAuthorized).toBe(true);expect(session.connected).toBe(false);
    session.disconnect();
    expect(new GoogleSession(config,true).previouslyAuthorized).toBe(false);
  });
});
