import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), { status, headers:{...cors,"Content-Type":"application/json"}});
async function digest(value:string) {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function session(req:Request) {
  const token=req.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
  if(!token) return null;
  const {data:s}=await admin.from("app_sessions").select("user_id,expires_at,app_users(role,active)").eq("token_hash",await digest(token)).maybeSingle();
  if(!s || new Date(s.expires_at)<=new Date() || !(s.app_users as any)?.active) return null;
  return {userId:s.user_id,role:(s.app_users as any).role};
}
Deno.serve(async req=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  try {
    const body=await req.json(); const action=body.action;
    if(action==="login"){
      const pin=String(body.pin||""); if(!/^\d{4,6}$/.test(pin)) return json({error:"Invalid PIN"},401);
      const {data:users}=await admin.from("app_users").select("id,role,pin_hash").eq("active",true);
      const user=users?.find((u:any)=>false); // hashes are verified below by Postgres crypt.
      const {data:match}=await admin.rpc("ricotta_verify_pin",{p_pin:pin});
      if(!match) return json({error:"Invalid PIN"},401);
      const token=crypto.randomUUID()+crypto.randomUUID(); const tokenHash=await digest(token);
      await admin.from("app_sessions").insert({user_id:match.id,token_hash:tokenHash,expires_at:new Date(Date.now()+1000*60*60*12).toISOString()});
      return json({token,role:match.role,expiresAt:new Date(Date.now()+1000*60*60*12).toISOString()});
    }
    const me=await session(req); if(!me) return json({error:"Session expired"},401);
    if(action==="bootstrap"){
      const [suppliers,items,units,orders]=await Promise.all([
        admin.from("suppliers").select("*").order("name"), admin.from("items").select("*").order("name"),
        admin.from("units").select("*").order("en"), admin.from("orders").select("*,order_lines(*)").order("updated_at",{ascending:false})
      ]);
      return json({suppliers:suppliers.data||[],items:items.data||[],units:units.data||[],orders:orders.data||[]});
    }
    if(action==="save_order"){
      const order=body.order; if(!order?.supplierId || !Array.isArray(order.lines)||!order.lines.length) return json({error:"Order needs a supplier and items"},400);
      const payload={supplier_id:order.supplierId,status:"draft",created_by:me.userId,updated_at:new Date().toISOString()};
      let id=order.id;
      if(id) { const {error}=await admin.from("orders").update(payload).eq("id",id).eq("status","draft"); if(error) throw error; await admin.from("order_lines").delete().eq("order_id",id); }
      else { const {data,error}=await admin.from("orders").insert(payload).select("id").single(); if(error) throw error; id=data.id; }
      const {error}=await admin.from("order_lines").insert(order.lines.map((l:any)=>({order_id:id,item_id:l.itemId,item_name:l.name,unit_id:l.unit,quantity:l.qty}))); if(error) throw error;
      return json({id});
    }
    if(action==="mark_sent"){
      const {error}=await admin.from("orders").update({status:"sent",sent_by:me.userId,sent_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",body.id).eq("status","draft");
      if(error) throw error; return json({ok:true});
    }
    if(action==="create_sent"){
      const entries=body.entries||[]; const now=new Date().toISOString();
      for(const e of entries){
        const {data:o,error}=await admin.from("orders").insert({supplier_id:e.supplierId==='__none'?null:e.supplierId,status:"sent",created_by:me.userId,sent_by:me.userId,sent_at:now}).select("id").single();
        if(error) throw error;
        const {error:linesError}=await admin.from("order_lines").insert(e.items.map((l:any)=>({order_id:o.id,item_id:l.itemId,item_name:l.name,unit_id:l.unit,quantity:l.qty})));
        if(linesError) throw linesError;
      }
      return json({ok:true});
    }
    if(action==="catalog" && me.role==="admin"){
      const table=body.table; if(!["suppliers","items","units"].includes(table)) return json({error:"Invalid catalog table"},400);
      const {error}=await admin.from(table).upsert(body.rows); if(error) throw error; return json({ok:true});
    }
    return json({error:"Not allowed"},403);
  } catch(error) { console.error(error); return json({error:"Request failed"},500); }
});
