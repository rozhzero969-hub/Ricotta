/* The browser and Rico use the same matcher. No network calls or guessed translations. */
(function () {
  const normalized=new Map(),documents=new Map();
  function remember(cache,key,value,limit){if(cache.size>=limit)cache.delete(cache.keys().next().value);cache.set(key,value);return value;}

  function normalize(value) {
    const raw=String(value??'');if(normalized.has(raw))return normalized.get(raw);
    const result=raw.normalize('NFKD').toLowerCase()
      .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/[يىێ]/g, 'ی').replace(/[كگ]/g, 'ک')
      .replace(/[ةەھہ]/g, 'ه').replace(/[ۆۇۊؤ]/g, 'و').replace(/ڵ/g, 'ل').replace(/ڕ/g, 'ر')
      .replace(/پ/g, 'ب').replace(/چ/g, 'ج').replace(/ژ/g, 'ز').replace(/ڤ/g, 'ف')
      .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
      .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0))
      .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
    return remember(normalized,raw,result,2000);
  }
  function stem(word) {
    if (!/^[a-z]{4,}$/.test(word)) return word;
    return word.replace(/ies$/, 'y').replace(/oes$/, 'o').replace(/(?<!s)s$/, '');
  }
  function distance(a, b) {
    const rows = [Array.from({length:b.length+1}, (_,i)=>i)];
    for (let i=1;i<=a.length;i++) {
      const row=[i];
      for(let j=1;j<=b.length;j++) {
        row[j]=Math.min(row[j-1]+1, rows[i-1][j]+1, rows[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
        if(i>1 && j>1 && a[i-1]===b[j-2] && a[i-2]===b[j-1]) row[j]=Math.min(row[j],rows[i-2][j-2]+1);
      }
      rows.push(row);
    }
    return rows[a.length][b.length];
  }
  function score(query, fields, fuzzy=true) {
    const q=normalize(String(query).slice(0,200));
    if(!q) return 0;
    const raw=Array.isArray(fields)?fields:[fields],key=JSON.stringify(raw);
    let doc=documents.get(key);
    if(!doc){const text=raw.map(normalize).filter(Boolean);doc=remember(documents,key,{text,words:text.join(' ').split(' ').map(stem)},600);}
    const text=doc.text;
    let best=Infinity;
    text.forEach((s,i)=>{if(s===q)best=Math.min(best,i?2:0);else if(s.startsWith(q))best=Math.min(best,4+i);else if(s.includes(q))best=Math.min(best,8+i);});
    if(Number.isFinite(best))return best;
    const words=doc.words, tokens=q.split(' ').map(stem);
    let cost=12;
    for(const token of tokens) {
      if(words.includes(token))continue;
      if(!/^\d+$/.test(token) && words.some(w=>w.startsWith(token))) {cost+=2;continue;}
      const max=token.length>=8?2:token.length>=4?1:0;
      if(!fuzzy || !max || /\d/.test(token) || !words.some(w=>! /\d/.test(w) && Math.abs(w.length-token.length)<=max && distance(token,w)<=max))return Infinity;
      cost+=20;
    }
    return cost;
  }
  function rank(rows, query, fields) {
    return rows.map((row,index)=>({row,index,score:score(query,fields(row))})).filter(x=>Number.isFinite(x.score)).sort((a,b)=>a.score-b.score || a.index-b.index).map(x=>x.row);
  }
  /* Units the way people write or say them in Kurdish, Arabic and English; each group is one unit, with the
     workplace system's own spelling first and its English name as the first English word. */
  const UNIT_GROUPS=[
    ['کیلۆ','کیلو','كيلو','کلو','كلو','کیلۆگرام','کیلوگرام','كيلوغرام','كيلوجرام','كغ','كجم','kg','kgs','kgm','kilo','kilos','kilu','kilogram','kilograms','kilogramme','kilogrammes'],
    ['غرام','گرام','جرام','غم','غ','g','gm','gms','gr','grs','grm','gram','grams','gramme','grammes'],
    ['ملی لتر','ملی لیتر','مل','مللتر','ملليتر','مليلتر','ml','mls','millilitre','milliliter','millilitres','milliliters'],
    ['لتر','لیتر','ليتر','l','lt','ltr','ltrs','litre','liter','litres','liters'],
    ['دانە','دانه','قطعة','حبة','عدد','piece','pieces','pcs','pc','pce','each','bottle','bottles'],
    ['سیت','سێت','set','sets'],
    ['ستل','سەتڵ','سطل','bucket','buckets','pail','pails','tub','tubs'],
    ['فەردە','فردة','کیسە','كيس','sack','sacks','bag','bags'],
    ['کارتۆن','كارتون','carton','cartons','ctn','ctns','cartoon','cartoons'],
    ['پاکەت','پاکێت','باكيت','pack','packs','packet','packets','pkt','pkts'],
    ['تەبەقە','طبقة','tray','trays'],
    ['جام','jar','jars','pot','pots','bowl','bowls'],
    ['مەتر','متر','meter','meters','metre','metres','mtr','m'],
    ['سندوق','صندوق','box','boxes','case','cases','crate','crates'],
    ['تەنەکە','تنكة','tin','tins','can','cans'],
  ];
  const unitGroup=value=>{const v=normalize(value);return v?UNIT_GROUPS.find(g=>g.some(w=>normalize(w)===v))||null:null;};
  /* The item's own unit for what was written (کیلۆ, kg and كيلو are one unit); null when none fits.
     With nothing written, an item that has only one unit uses it. */
  function unit(units, said) {
    const s=normalize(said);
    if(!s)return units.length===1?units[0]:null;
    const same=units.find(u=>normalize(u)===s);
    if(same)return same;
    const group=unitGroup(said);
    return group?units.find(u=>group.some(w=>normalize(w)===normalize(u)))||null:null;
  }
  // The same unit in another size: 1 کیلۆ is 1000 غرام, 1 لتر is 1000 ملی لتر.
  const UNIT_SIZES=[[UNIT_GROUPS[0],UNIT_GROUPS[1],1000],[UNIT_GROUPS[3],UNIT_GROUPS[2],1000]];
  /* The amount in one of the item's own units: {unit, amount}, or null when none fits. An item counted in
     another size of the written unit gets the exact amount (2 kg is 2000 غرام); nothing is ever rounded to fit. */
  function fit(units, said, amount) {
    const same=unit(units,said);
    if(same)return {unit:same,amount};
    const group=unitGroup(said);
    if(!group || !(amount>0))return null;
    for(const [big,small,times] of UNIT_SIZES){
      const to=group===big?small:group===small?big:null;
      const mine=to&&units.find(u=>to.some(w=>normalize(w)===normalize(u)));
      if(!mine)continue;
      const exact=group===big?amount*times:amount/times, value=Math.round(exact*1000)/1000;
      if(value>0 && value<=99999 && Math.abs(value-exact)<1e-9)return {unit:mine,amount:value};
    }
    return null;
  }
  /* Is this word a unit (one of the known spellings, or one of the given units)? */
  function isUnit(word, units=[]) { const s=normalize(word); return !!s && (!!unitGroup(word) || units.some(u=>normalize(u)===s)); }
  // The English name of each known unit (kg, g, ml, l, piece, ...), for Rico to say which one a written unit is.
  const unitNames=Object.freeze(UNIT_GROUPS.map(g=>g.find(w=>/^[a-z]/.test(w))));
  globalThis.RicottaSearch=Object.freeze({normalize,score,rank,unit,fit,isUnit,unitNames});
})();
