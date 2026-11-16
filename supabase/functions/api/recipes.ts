import { catalogOf } from "./receipts.ts";
type Ctx={db:any;json:(v:unknown,s?:number)=>Response;fail:(v:string,s?:number)=>Response;account:string};
const uuid=(v:any)=>typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const str=(v:any,n:number)=>typeof v==='string' && v.trim().length<=n?v.trim():'';
const bucket='recipe-photos';
export async function recipesRoute(c:Ctx,M:string,path:string,b:any){
 const {db,json,fail}=c, table=(s:string)=>db.from('app_'+s);
 if(M==='GET' && path==='recipes'){
  const [r,i,cat]=await Promise.all([table('recipes').select('*').order('updated_at',{ascending:false}).limit(500),table('recipe_ingredients').select('*').order('name').limit(2000),catalogOf(db)]);
  if(r.error||i.error)return fail('load_failed',503);
  return json({recipes:r.data,ingredients:i.data,stock:(cat.titems||[]).map((x:any)=>({name:x.name,units:[...new Set([x.base,x.count?.name,x.buy?.name].filter(Boolean))]})),stockAt:cat.at});
 }
 if(M==='PUT' && path.startsWith('recipe-ingredients/')){
  const id=path.split('/')[1],name=str(b.name,120),stock=str(b.stock_item,200),unit=str(b.unit,80);
  if(!uuid(id)||!name||!stock||!unit||!Number.isInteger(b.version)||b.version<0)return fail('invalid_input');
  const cat=await catalogOf(db),item=(cat.titems||[]).find((x:any)=>x.name===stock);
  if(!item||![item.base,item.count?.name,item.buy?.name].includes(unit))return fail('invalid_stock_link',422);
  let q;
  if(b.version===0)q=table('recipe_ingredients').insert({id,name,stock_item:stock,unit}).select();
  else q=table('recipe_ingredients').update({name,stock_item:stock,unit,version:b.version+1,updated_at:new Date().toISOString()}).eq('id',id).eq('version',b.version).select();
  const r=await q;if(r.error||!r.data?.length)return fail('recipe_conflict',409);return json(r.data[0]);
 }
 const match=path.match(/^recipes\/([0-9a-f-]+)(?:\/(photos)(?:\/([0-9a-f-]+))?)?$/i);
 if(!match||!uuid(match[1]))return fail('not_found',404);
 const id=match[1];
 if(!match[2] && M==='PUT'){
  const name=str(b.name,120),d=b.data;
  if(!name||!d||!Number.isInteger(b.version)||b.version<0||typeof b.archived!=='boolean'||!['draft','ready'].includes(d.status)||!Array.isArray(d.lines)||d.lines.length>100||!Array.isArray(d.steps)||d.steps.length>60||d.steps.some((s:any)=>typeof s!=='string'||s.length>3000)||typeof d.notes!=='string'||d.notes.length>8000||typeof d.category!=='string'||d.category.length>60||typeof d.yieldUnit!=='string'||d.yieldUnit.length>60||!Number.isFinite(d.yield)||d.yield<=0||d.yield>100000||![d.prep,d.cook].every(n=>Number.isInteger(n)&&n>=0&&n<=100000))return fail('invalid_input');
  const clean={status:d.status,lines:d.lines,steps:d.steps,notes:d.notes,category:d.category,yield:d.yield,yieldUnit:d.yieldUnit,prep:d.prep,cook:d.cook};
  const {data:ingredients,error}=await table('recipe_ingredients').select('id,unit').limit(2000);
  if(error)return fail('load_failed',503);
  if(d.lines.some((l:any)=>!uuid(l?.ingredient)||!ingredients?.some((i:any)=>i.id===l.ingredient&&i.unit===l.unit)||!Number.isFinite(l.qty)||l.qty<=0||l.qty>999999||Number(l.qty.toFixed(3))!==l.qty))return fail('invalid_ingredients',422);
  if(d.status==='ready'&&(!d.lines.length||!d.steps.some((s:string)=>s.trim())))return fail('incomplete_recipe',422);
  const row={name,data:clean,archived:b.archived,updated_by:c.account,updated_at:new Date().toISOString()};
  const r=await (b.version===0?table('recipes').insert({id,...row}):table('recipes').update({...row,version:b.version+1}).eq('id',id).eq('version',b.version)).select();
  return r.error||!r.data?.length?fail('recipe_conflict',409):json(r.data[0]);
 }
 const recipe=await table('recipes').select('id').eq('id',id).maybeSingle();
 if(recipe.error)return fail('load_failed',503);if(!recipe.data)return fail('not_found',404);
 if(match[2]&&M==='GET'){
  const r=await table('recipe_photos').select('*').eq('recipe_id',id).order('created_at');if(r.error)return fail('load_failed',503);
  const photos=await Promise.all(r.data.map(async(p:any)=>{const signed=await db.storage.from(bucket).createSignedUrl(p.path,900);return {...p,url:signed.data?.signedUrl||null};}));return json(photos);
 }
 if(match[2]&&M==='POST'){
  const count=await table('recipe_photos').select('id',{count:'exact',head:true}).eq('recipe_id',id);
  if(count.error)return fail('save_failed',503);if(count.count>=8)return fail('too_many_photos',422);
  if(typeof b.image!=='string'||b.image.length>4_000_000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(b.image))return fail('invalid_photo');
  let bytes;try{bytes=Uint8Array.from(atob(b.image.split(',')[1]),c=>c.charCodeAt(0));}catch{return fail('invalid_photo');}
  if(bytes.length>3_000_000||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)return fail('invalid_photo');
  const photo=crypto.randomUUID(),key=id+'/'+photo+'.jpg',store=db.storage.from(bucket);
  const upload=await store.upload(key,bytes,{contentType:'image/jpeg',upsert:false});if(upload.error)return fail('upload_failed',503);
  const r=await table('recipe_photos').insert({id:photo,recipe_id:id,path:key,caption:str(b.caption,200)});
  if(r.error){await store.remove([key]);return fail('save_failed',503);}return json({ok:true});
 }
 if(match[3]&&uuid(match[3])&&M==='DELETE'){
  const p=await table('recipe_photos').select('*').eq('recipe_id',id).eq('id',match[3]).maybeSingle();if(p.error)return fail('load_failed',503);if(!p.data)return fail('not_found',404);
  const removed=await db.storage.from(bucket).remove([p.data.path]);if(removed.error)return fail('save_failed',503);
  const r=await table('recipe_photos').delete().eq('id',p.data.id);return r.error?fail('save_failed',503):json({ok:true});
 }
 return fail('not_found',404);
}
