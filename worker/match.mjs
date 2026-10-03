// How the PC finds a name in the workplace system's lists.
const norm=s=>String(s??'').replace(/\s+/g,' ').trim();
// Names are compared the way a person reads them, so Kurdish written with Arabic letters or another keyboard
// still matches: تةمـاتة is تەماتە. These do not count: harakat, the stretch ـ, invisible direction marks,
// letter shapes (presentation forms), ة ە ه ھ, ی ي ى ێ, ک ك گ, و ۆ ؤ, ڵ ل, ڕ ر, پ ب, چ ج, ژ ز, ڤ ف, أ إ آ ا,
// Arabic/Persian digits, the spaces around "/" or "-", and capital letters. A choice must still be the only match.
const FOLD=[[/[\u064B-\u065F\u0670\u0640\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g,''],[/[\u0623\u0625\u0622\u0671]/g,'\u0627'],
  [/[\u064A\u0649\u06CE]/g,'\u06CC'],[/[\u0643\u06AF]/g,'\u06A9'],[/[\u0629\u06D5\u06BE\u06C1]/g,'\u0647'],[/[\u06C6\u06C7\u06CA\u0624]/g,'\u0648'],
  [/\u06B5/g,'\u0644'],[/\u0695/g,'\u0631'],[/\u067E/g,'\u0628'],[/\u0686/g,'\u062C'],[/\u0698/g,'\u0632'],[/\u06A4/g,'\u0641'],
  [/[\u0660-\u0669]/g,d=>String(d.charCodeAt(0)-0x660)],[/[\u06F0-\u06F9]/g,d=>String(d.charCodeAt(0)-0x6F0)],[/[\u2013\u2014]/g,'-']];
export const same=s=>norm(FOLD.reduce((t,[re,to])=>t.replace(re,to),String(s??'').normalize('NFKC')).replace(/\s*([/|-])\s*/g,' $1 ')).toLocaleLowerCase('en');
// Units are short words, so spaces do not count either ("ملی لتر" is "ملیلتر"). A workplace unit may
// read "کیلۆ (×1000)"; the part in brackets is ignored.
export const unitKey=s=>same(String(s??'').replace(/\s*\((?:×|x)[^)]*\)\s*$/i,'')).replace(/\s+/g,'');
export const sameUnit=(a,b)=>!!unitKey(b)&&unitKey(a)===unitKey(b);
// What to type in a search box. The whole two-language name ("Golden Bread Bakery / صمون گۆلدن برید") can
// find nothing there, so: the first half, then its first word, then nothing (the full list).
export function searchTerms(name){
  const first=norm(String(name).split(/\s[/|]\s|\s[-\u2013\u2014]\s/)[0]);
  return [...new Set([first,first.split(' ')[0],''])];
}
// With a list already open: types the search terms one after another (when there is a search box), clicks the
// only option that has a line matching `wanted`, and returns that line exactly as the workplace writes it.
export async function pickNamed(page,searchBox,wanted,label){
  const opts=page.getByRole('option');
  for(const term of searchBox?searchTerms(wanted):[null]){
    if(term!==null)await searchBox.fill(term);
    const end=Date.now()+2000;let last=-1;   // wait until the list stops changing
    for(;;){const n=await opts.count();if((n===last&&n>0)||Date.now()>end)break;last=n;await page.waitForTimeout(80)}
    const n=await opts.count(),hits=[];
    for(let i=0;i<n;i++){
      const line=(await opts.nth(i).innerText().catch(()=>'')).split('\n').map(norm).find(x=>same(x)===same(wanted));
      if(line)hits.push({i,line});
    }
    if(hits.length>1)throw new Error(`${label} ${wanted} is ambiguous on the workplace page (${hits.length} matches)`);
    if(hits.length===1){await opts.nth(hits[0].i).click();return hits[0].line}
  }
  throw new Error(`${label} ${wanted} is not on the workplace page. Its name in Ricotta must match the workplace name.`);
}
