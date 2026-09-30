// Ricotta transfer API. Only this function can reach the private transfer tables.
import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const origin = Deno.env.get("ALLOWED_ORIGIN") || "https://rozhzero969-hub.github.io";
const cors = { "Access-Control-Allow-Origin": origin, "Vary": "Origin",
  "Access-Control-Allow-Headers": "content-type,x-session-token,x-worker-token,apikey,authorization",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS", "Access-Control-Max-Age": "3600" };
const out = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const err = (message: string, status = 400) => out({error:message},status);
const str = (x: unknown, max=240) => String(x ?? "").trim().slice(0,max);
const sha256 = async (v: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v)))].map(x=>x.toString(16).padStart(2,"0")).join("");
async function body(req: Request) {
  if (Number(req.headers.get("content-length") || 0)>65536) throw new Error("Request too large");
  const raw=await req.text(); if(raw.length>65536) throw new Error("Request too large");
  try{return JSON.parse(raw)}catch{throw new Error("Invalid JSON")}
}
async function person(req: Request) {
  const token=req.headers.get("x-session-token"); if(!token) return null;
  const {data,error}=await db.from("app_sessions").select("account,expires_at,revoked_at")
    .eq("token_hash",await sha256(token)).maybeSingle();
  if(error || !data || data.revoked_at || new Date(data.expires_at).getTime()<=Date.now()) return null;
  return data.account === "rozha" || data.account === "yunis" ? data.account as string : null;
}
async function worker(req: Request) {
  const token=req.headers.get("x-worker-token"); if(!token || token.length<32) return null;
  const {data,error}=await db.from("transfer_workers").select("id").eq("token_hash",await sha256(token)).eq("enabled",true).maybeSingle();
  return error ? null : data?.id ?? null;
}
const uuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v));
const numeric = (v:unknown) => typeof v === "number" || (typeof v === "string" && /^\d+(?:\.\d{1,6})?$/.test(v));
function queryError(e: any) { return String(e?.message || "Database operation failed").slice(0,400); }
async function fetchRequest(id: string) {
  const [r,l] = await Promise.all([
    db.from("transfer_requests").select("*").eq("id",id).single(),
    db.from("transfer_lines").select("*").eq("request_id",id).order("id")
  ]);
  if(r.error || l.error) throw new Error(queryError(r.error || l.error));
  return {...r.data,lines:l.data};
}
function cleanItem(b:any) {
  const exact_name=str(b.exact_name), counting_unit=str(b.counting_unit,80);
  if(!exact_name || !counting_unit) throw new Error("Exact name and counting unit are required");
  const low_stock=b.low_stock==="" || b.low_stock==null ? null : b.low_stock;
  if(low_stock!==null && (!numeric(low_stock) || Number(low_stock)<0)) throw new Error("Invalid low stock threshold");
  return {exact_name,counting_unit,usage_unit:str(b.usage_unit,80)||null,buying_unit:str(b.buying_unit,80)||null,low_stock};
}
function cleanUnits(raw:any, counting:string) {
  if(!Array.isArray(raw) || raw.length>10) throw new Error("Invalid units");
  const map=new Map<string,{unit:string,count_per_unit:number|null,verified:boolean}>();
  map.set(counting,{unit:counting,count_per_unit:1,verified:true});
  for(const row of raw) {
    const unit=str(row.unit,80); if(!unit || unit===counting || map.has(unit)) throw new Error("Duplicate or invalid unit");
    const factor=row.count_per_unit==="" || row.count_per_unit==null ? null : Number(row.count_per_unit);
    const verified=Boolean(row.verified);
    if(factor!==null && (!Number.isFinite(factor) || factor<=0 || factor>100000000)) throw new Error("Invalid conversion");
    if(verified && factor===null) throw new Error("Verified unit needs a conversion");
    map.set(unit,{unit,count_per_unit:factor,verified});
  }
  return [...map.values()];
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
  const segments=new URL(req.url).pathname.split("/").filter(Boolean);
  const at=segments.lastIndexOf("transfer-api");
  const path=at>=0?segments.slice(at+1):segments;
  try {
    // The PC token grants queue access only. The browser session grants catalog access.
    if(path[0]==="worker") {
      const who=await worker(req); if(!who) return err("Worker authentication required",401);
      if(req.method==="GET" && path[1]==="preview") {
        const {data,error}=await db.from("transfer_requests").select("id").eq("status","waiting").order("approved_at").limit(1).maybeSingle();
        if(error) throw error;
        return out({request:data ? await fetchRequest(data.id):null});
      }
      if(req.method==="GET" && path[1]==="balance") {
        const url=new URL(req.url),item=url.searchParams.get('item'),storage=url.searchParams.get('storage');
        if(!uuid(item)||!storage) return err('Invalid balance lookup');
        const {data,error}=await db.from('transfer_balances').select('quantity').eq('item_id',item).eq('storage_name',storage).maybeSingle();
        if(error) throw error; return out({quantity:data?.quantity ?? 0});
      }
      if(req.method==="POST" && path[1]==="claim") {
        const {data,error}=await db.rpc("transfer_claim",{p_worker:who}); if(error) throw error;
        return out({request:data ? await fetchRequest(data):null});
      }
      if(req.method==="POST" && path[1]==="report") {
        const b=await body(req);
        if(!uuid(b.id) || !["completed","failed","needs_checking"].includes(b.status)) return err("Invalid report");
        const {error}=await db.rpc("transfer_finish",{p_id:b.id,p_worker:who,p_status:b.status,
          p_message:str(b.message,1000),p_line_results:Array.isArray(b.line_results)?b.line_results:[]});
        if(error) throw error;
        return out({request:await fetchRequest(b.id)});
      }
      return err("Unknown worker route",404);
    }
    const actor=await person(req); if(!actor) return err("Sign in to Ricotta Orders first",401);
    if(req.method==="GET" && path[0]==="bootstrap") {
      const results=await Promise.all([
        db.from("transfer_storages").select("*").order("sort_order"),
        db.from("transfer_items").select("*").order("exact_name"),
        db.from("transfer_units").select("*"),
        db.from("transfer_balances").select("*"),
        db.from("transfer_requests").select("*").order("approved_at",{ascending:false}).limit(100),
        db.from("transfer_counts").select("*").order("entered_at",{ascending:false}).limit(100)
      ]);
      for(const r of results) if(r.error) throw r.error;
      const ids=(results[4].data||[]).map((r:any)=>r.id);
      const lines=ids.length ? await db.from("transfer_lines").select("*").in("request_id",ids).limit(1000) : {data:[],error:null};
      if(lines.error) throw lines.error;
      return out({actor,storages:results[0].data,items:results[1].data,units:results[2].data,
        balances:results[3].data,requests:results[4].data,counts:results[5].data,lines:lines.data});
    }
    if(req.method==="POST" && path[0]==="requests") {
      const b=await body(req);
      if(!uuid(b.client_key) || !Array.isArray(b.lines) || b.lines.length<1 || b.lines.length>20 ||
        b.lines.some((l:any)=>!uuid(l.item_id)||!str(l.unit,80)||!numeric(l.quantity)||Number(l.quantity)<=0)) return err("Invalid transfer request");
      const {data,error}=await db.rpc("transfer_submit",{p_key:b.client_key,p_from:str(b.from_storage,80),
        p_to:str(b.to_storage,80),p_yesterday:b.record_yesterday===true,p_actor:actor,p_lines:b.lines});
      if(error) throw error;
      return out({request:await fetchRequest(data)},201);
    }
    if(req.method==="POST" && path[0]==="counts") {
      const b=await body(req);
      if(!uuid(b.item_id)||!numeric(b.quantity)||!b.counted_at || isNaN(Date.parse(b.counted_at))) return err("Invalid count");
      const {data,error}=await db.rpc("transfer_recount",{p_item:b.item_id,p_storage:str(b.storage_name,80),p_unit:str(b.unit,80),
        p_quantity:b.quantity,p_counted_at:b.counted_at,p_actor:actor,p_note:str(b.note,500)});
      if(error) throw error;
      return out({id:data},201);
    }
    if(req.method==="POST" && path[0]==="resolve") {
      const b=await body(req);
      if(!uuid(b.id)||!["completed","failed"].includes(b.status)||str(b.note,900).length<10)
        return err("Check the workplace transfer history and enter a note of at least 10 characters");
      if(b.status==='completed' && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.recorded_date||'')))
        return err("Enter the verified workplace recorded date");
      const {error}=await db.rpc("transfer_resolve",{p_id:b.id,p_actor:actor,p_status:b.status,
        p_note:str(b.note,900),p_recorded_date:b.status==='completed'?b.recorded_date:null});
      if(error) throw error;
      return out({request:await fetchRequest(b.id)});
    }
    if(path[0]==="items" && req.method==="POST" && path.length===1) {
      const b=await body(req), item=cleanItem(b), units=cleanUnits(b.units||[],item.counting_unit);
      const {data,error}=await db.rpc("transfer_save_item",{p_id:null,p_actor:actor,
        p_doc:{...item,match_verified:b.match_verified===true,units:units.slice(1)}});
      if(error) throw error;
      return out({id:data},201);
    }
    if(path[0]==="items" && uuid(path[1]) && req.method==="PUT") {
      const id=path[1];
      const b=await body(req);
      if(path[2]==="archive") {
        const {error}=await db.rpc("transfer_set_archive",{p_id:id,p_actor:actor,p_archived:b.archived===true});
        if(error) throw error; return out({ok:true});
      }
      const {data:old,error:oldErr}=await db.from("transfer_items").select("*").eq("id",id).single();
      if(oldErr || !old) return err("Item not found",404);
      const item=cleanItem({...old,...b});
      if(item.counting_unit!==old.counting_unit) return err("Counting unit cannot change after creation; add another unit instead");
      const units=cleanUnits(b.units||[],item.counting_unit);
      const {error}=await db.rpc("transfer_save_item",{p_id:id,p_actor:actor,
        p_doc:{...item,match_verified:b.match_verified===true,units:units.slice(1)}});
      if(error) throw error;
      return out({ok:true});
    }
    return err("Unknown route",404);
  } catch(e) {
    // Do not disclose database connection details or secrets to the phone.
    const message=queryError(e);
    console.error("transfer-api",message);
    return err(/Invalid|Insufficient|unverified|unavailable|Duplicate|Resolve|unit|stock|balance|Item|Transfer|Empty|count|quantity|storages|actor/i.test(message)?message:"Operation failed; check server logs",400);
  }
});
