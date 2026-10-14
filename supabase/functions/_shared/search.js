/* The browser and Rico use the same matcher. No network calls or guessed translations. */
(function () {
  function normalize(value) {
    return String(value ?? '').normalize('NFKD').toLowerCase()
      .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/[يىێ]/g, 'ی').replace(/[كگ]/g, 'ک')
      .replace(/[ةەھہ]/g, 'ه').replace(/[ۆۇۊؤ]/g, 'و').replace(/ڵ/g, 'ل').replace(/ڕ/g, 'ر')
      .replace(/پ/g, 'ب').replace(/چ/g, 'ج').replace(/ژ/g, 'ز').replace(/ڤ/g, 'ف')
      .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
      .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0))
      .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
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
    const text=(Array.isArray(fields)?fields:[fields]).map(normalize).filter(Boolean);
    let best=Infinity;
    text.forEach((s,i)=>{if(s===q)best=Math.min(best,i?2:0);else if(s.startsWith(q))best=Math.min(best,4+i);else if(s.includes(q))best=Math.min(best,8+i);});
    if(Number.isFinite(best))return best;
    const words=text.join(' ').split(' ').map(stem), tokens=q.split(' ').map(stem);
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
  globalThis.RicottaSearch=Object.freeze({normalize,score,rank});
})();
