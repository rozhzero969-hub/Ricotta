/* Ordering items linked to Ricotta Restaurant's stock items: one set of rules for the app and the API.
   Rozh links each ordering item to a stock item herself (Manage, Link stock items, or edit an item).
   matches() says whether the names really match (Mozzarella and Banana don't); a link they don't match
   is only made after the app warned and she chose Link anyway. rank() and suggest() pick the stock items
   to offer, from the names and what else is known (sizes, supplier, unit). The Order screen then shows
   how much of it is in Main Storage, in the buying unit when it is a whole number of them (2 cartons),
   otherwise in the counting unit (31 pieces). Needs RicottaSearch (search.js) and RicottaTransfers
   (transfers.js) loaded first. */
(function () {
  const MAIN = 'Main Storage';
  const S = () => globalThis.RicottaSearch;
  const T = () => globalThis.RicottaTransfers;

  /* Words that say what kind of thing it is, not which thing (cheese, milk, oil...). A link needs at
     least one word that is not one of these, unless the name is only such words ("Milk"). Written
     after normalize() (پ is ب, ە is ه, ی for ي/ى/ێ). */
  const GENERIC = new Set([
    'cheese', 'milk', 'oil', 'sauce', 'powder', 'fresh', 'frozen', 'red', 'green', 'white', 'black', 'yellow',
    'big', 'small', 'large', 'medium', 'mini', 'pack', 'box', 'bag', 'bottle', 'can', 'jar', 'tin', 'carton',
    'juice', 'water', 'paste', 'cream', 'flour', 'sugar', 'salt', 'spice', 'spices', 'mix', 'bread', 'meat',
    'chicken', 'beef', 'fish', 'leaf', 'leaves', 'seed', 'seeds', 'dry', 'dried', 'whole', 'sliced', 'chopped',
    'the', 'and', 'with', 'of', 'for', 'kg', 'gram', 'g', 'ml', 'l', 'liter', 'litre', 'piece', 'pcs',
    // Kurdish and Arabic, normalized
    'بنیر', 'جبن', 'جبنه', 'شیر', 'حلیب', 'زهیت', 'زیت', 'سوس', 'صلصه', 'بودر', 'شیره', 'ئاو', 'ماء', 'نان', 'خبز',
    'گوشت', 'کوشت', 'لحم', 'مریشک', 'دجاج', 'ماسی', 'سمک', 'شکر', 'سکر', 'خوی', 'ملح', 'ارد', 'طحین', 'سور', 'سبز',
    'سهوز', 'احمر', 'اخضر', 'گهوره', 'کهوره', 'بچوک', 'کبیر', 'صغیر', 'و', 'لیتر', 'لتر', 'کیلو', 'غرام', 'دانه',
  ]);

  /* The meaningful words of a name: normalized, stemmed, without numbers, sizes (20*225, 1l) or unit
     words, and with the Kurdish linking ending ی taken off (پەنیری مۆزارێلا is "mozzarella cheese"). */
  /* The words of a name are worked out once and kept (the link list compares every item with every stock
     item, so the same names come up thousands of times). */
  const WORDS = new Map();
  function words(name) {
    const key = String(name ?? '');
    const hit = WORDS.get(key);
    if (hit) return hit;
    const out = wordsOf(key);
    if (WORDS.size > 5000) WORDS.clear();
    WORDS.set(key, out);
    return out;
  }
  function wordsOf(name) {
    const out = [];
    for (let w of S().normalize(name).split(' ')) {
      if (!w || /\d/.test(w)) continue;
      if (/^[a-z]+$/.test(w)) { w = w.replace(/ies$/, 'y').replace(/oes$/, 'o').replace(/(?<![s])s$/, ''); if (w.length < 2) continue; }
      else if (w.length >= 4 && w.endsWith('ی')) w = w.slice(0, -1);
      if (S().isUnit(w)) continue;
      out.push(w);
    }
    return out;
  }
  function dist(a, b) {
    const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[m][n];
  }
  /* Two words are the same word: equal, one a longer form of the other (4+ letters), or a small typo
     (1 letter in 5 to 7, 2 letters in 8 or more). */
  function same(a, b) {
    if (a === b) return true;
    const short = a.length <= b.length ? a : b, long = short === a ? b : a;
    if (short.length >= 4 && long.startsWith(short)) return true;
    const max = short.length >= 8 ? 2 : short.length >= 5 ? 1 : 0;
    return max > 0 && Math.abs(a.length - b.length) <= max && dist(a, b) <= max;
  }

  /* Does this stock item's name match the ordering item (its name or any of its search names)?
     Each part of a name ("English - Kurdish") and each search name is tried on its own; one is enough.
     A part matches when at least half of its words are in the stock name and one of the matched words
     is not a generic word. A part of only generic words must match a stock name of only those words. */
  function matches(item, stockName) {
    const stock = words(stockName);
    if (!stock.length || !item) return false;
    const names = [item.name, ...(Array.isArray(item.aliases) ? item.aliases : [])].filter(Boolean);
    const parts = names.flatMap((n) => [n, ...String(n).split(/\s+-\s+/)]);
    for (const part of parts) {
      const mine = [...new Set(words(part))];
      if (!mine.length) continue;
      const hit = mine.filter((w) => stock.some((s) => same(w, s)));
      const special = mine.filter((w) => !GENERIC.has(w));
      if (special.length ? hit.some((w) => !GENERIC.has(w)) && hit.length * 2 >= mine.length
        // Only generic words ("Milk", "Oil"): the stock item must be just that too, not "Olive Oil".
        : hit.length === mine.length && stock.every((s) => GENERIC.has(s) || mine.some((w) => same(w, s)))) return true;
    }
    return false;
  }

  /* How well a stock item fits an ordering item, worked out from more than the name, best first.
     The name: every name of the item ("English - Kurdish" parts and search names) against each part of
     the stock name, word by word. Words that many stock items share (juice, frozen, ice cream, Sunich)
     count for less than the ones that pick one thing out (peach, mango, Lurpak), and words of the stock
     name that the item doesn't have count against it, so "Sunich peach juice" fits "Sunich Peach Nectar"
     better than "Sunich Mango Juice". When the item also fits the stock name's other language, that
     counts too. Then what else is known (ctx and the option):
       size     the same number in both names (18L and 18 liters), or different ones (1 liter, 18L)
       supplier the item's supplier delivered this stock item on a receipt (option.from)
       unit     the item's unit is the stock item's buying or counting unit (option.units)
       bought   Ricotta Restaurant has deliveries of it (option.bought)
       taken    another ordering item is already linked to it (ctx.taken: Map stock name -> item name)
     ctx = {supplier, unit, taken}; every part of it, and of the option beyond its name, may be missing.
     Each result: {o, score, name, why:[...], warn:[...], matches, taken}. */
  const STATS = new WeakMap();
  function stats(options) {
    let st = STATS.get(options);
    if (st) return st;
    const df = new Map(), parts = new Map();
    for (const o of options) {
      if (!o || !o.name) continue;
      const ps = partsOf(o.name);
      parts.set(o, ps);
      for (const w of new Set(ps.flat())) df.set(w, (df.get(w) || 0) + 1);
    }
    const n = parts.size, top = 1 + Math.log(n + 1);
    st = { df, parts, n, top };
    STATS.set(options, st);
    return st;
  }
  // A name in parts: "Mozzarella - پەنیری مۆزارێلا" is two, each as its words (no empty parts).
  function partsOf(name) {
    const raw = String(name ?? '');
    const pieces = raw.split(/\s+-\s+/);
    return (pieces.length > 1 ? pieces : [raw]).map((p) => [...new Set(words(p))]).filter((p) => p.length);
  }
  /* For fitting, more words say only what kind of thing it is (on top of GENERIC): they count for little. */
  const SOFT = new Set([...GENERIC, 'drink', 'mixed', 'cocktail', 'vegetable', 'canned', 'pitted', 'smoked', 'plain',
    'regular', 'flavoured', 'flavored', 'roasted', 'instant', 'full', 'fat', 'al',
    'بودره', 'خواردنهوه', 'خواردنهوهی', 'شهربهت', 'تیکهل', 'قودی', 'بهستوو', 'سهتل', 'ستل', 'ئایس', 'کریم', 'عصیر', 'مجمد', 'سوس', 'صوص']);
  // Words that make it another thing made from it (Kiwi Syrup is not Kiwi, Pistachio Baklava not Pistachio).
  const OTHER = new Set(['syrup', 'nectar', 'شیله', 'baklava', 'بهقلاوه', 'spray', 'lemonade', 'flavouring', 'flavoring', 'تامی']);
  function weight(st, w) {
    const df = st.df.get(w);
    return df ? 1 + Math.log((st.n + 1) / (df + 1)) : st.top;
  }
  /* What a word counts for: a kind-of-thing word that both names have (powder, mixed) says little, but
     one that only one of them has (paste, juice, yellow) says they are different things: Tomato paste is
     not Tomato. A stock name's own extra words (a brand: Altunsa Tomato Paste) count a bit less than the
     item's, because stock names are often longer. */
  function count(st, w, hit, item) {
    const soft = SOFT.has(w), base = weight(st, w);
    return hit ? (soft ? 0.3 : 1) * base : soft ? 0.8 * base : item ? base : 0.6 * base;
  }
  /* How alike two words are for fitting: 1 the same, 0.8 one a longer form of the other (4+ letters,
     most of the longer one: Powder and Powdered), 0.5 when the longer one is much longer (Pepper and
     Pepperoni, لیمۆ and لیمۆندوزی), 0.7 a small typo that keeps the first letter (1 letter in 5 or 6, 2 in 7 or more: Mudheesh and
     Mudhish), else 0. Panko and Mango are not alike. */
  function sim(a, b) {
    if (a === b) return 1;
    const short = a.length <= b.length ? a : b, long = short === a ? b : a;
    if (short.length >= 4 && long.startsWith(short)) return short.length / long.length >= 0.75 ? 0.8 : 0.5;
    const max = short.length >= 7 ? 2 : short.length >= 5 ? 1 : 0;
    if (max && a[0] === b[0] && Math.abs(a.length - b.length) <= max && dist(a, b) <= max) return 0.7;
    // Kurdish and Arabic spell some vowels or leave them out (لبنە and لەبنە): the shorter
    // word is the longer one with only vowel letters left out. شباتا and شبیت are not.
    return short.length >= 4 && !/^[a-z]/.test(short) && vowelsOnly(short, long) ? 0.7 : 0;
  }
  function vowelsOnly(short, long) {
    if (short[0] !== long[0]) return false;
    let i = 0;
    for (const c of long) { if (i < short.length && c === short[i]) i++; else if (!'اوهی'.includes(c)) return false; }
    return i === short.length;
  }
  // How much of a stock name's words (weighted) any of the item's words cover, 0 to 1.
  function cover(st, mine, p) {
    let got = 0, all = 0;
    for (const y of p) { const s = Math.max(0, ...mine.map((x) => sim(x, y))), w = count(st, y, s > 0, false); all += w; got += w * s; }
    return all ? got / all : 0;
  }
  // Weighted overlap of two word lists, 0 to 1 (1: the same words).
  function fit(st, a, b) {
    let got = 0, all = 0;
    for (const x of a) { const s = Math.max(0, ...b.map((y) => sim(x, y))), w = count(st, x, s > 0, true); all += w; got += w * s; }
    for (const y of b) { const s = Math.max(0, ...a.map((x) => sim(x, y))), w = count(st, y, s > 0, false); all += w; got += w * s; }
    return all ? got / all : 0;
  }
  // The sizes in a name (18L, 20*225, ١.٢٠٠ کیلۆ), as numbers.
  function sizes(name) {
    const s = String(name ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/٫/g, '.');
    return (s.match(/\d+(?:[.,]\d+)?/g) || []).map((x) => Number(x.replace(',', '.'))).filter((x) => x > 0);
  }
  const sameSize = (a, b) => Math.abs(a - b) < 1e-9 || Math.abs(a * 1000 - b) < 1e-6 || Math.abs(a - b * 1000) < 1e-6;
  /* Two supplier names are the same supplier when a word of one that says which supplier (not "company"
     or "store") is in the other: شرکە مختار and کۆگای مختار, Golden Bread Bakery · صەمونی گۆڵدن برێد. */
  const SUPPLIER_WORDS = new Set(['شرکه', 'شرکهی', 'شرکت', 'شرکة', 'کوگا', 'کوگای', 'company', 'co', 'trading', 'general', 'store', 'market', 'bakery', 'اقران', 'افران']);
  function sameSupplier(a, b) {
    const wa = words(a).filter((w) => w.length >= 3 && !SUPPLIER_WORDS.has(w)), wb = words(b);
    return wa.some((x) => wb.some((y) => same(x, y)));
  }
  function itemNames(item) {
    const names = [item.name, ...(Array.isArray(item.aliases) ? item.aliases : [])].filter(Boolean).map(String);
    return names.flatMap((n) => { const p = n.split(/\s+-\s+/); return p.length > 1 ? [n, ...p] : [n]; });
  }
  function rank(item, options, ctx = {}) {
    if (!item || !Array.isArray(options)) return [];
    const st = stats(options), names = itemNames(item);
    let mine = names.map((n) => [...new Set(words(n))]).filter((p) => p.length);
    // A search name that is only part of a longer name ("Strawberry" next to "Strawberry ice cream")
    // says less about the item, so the longer one is what fits.
    mine = mine.filter((p, i) => !mine.some((q, j) => j !== i && q.length > p.length && p.every((w) => q.some((x) => sim(w, x) >= 0.8))));
    const all = [...new Set(mine.flat())];
    const mySizes = names.flatMap(sizes);
    const out = [];
    for (const o of options) {
      const theirs = st.parts.get(o);
      if (!theirs || !mine.length) continue;
      // The best pair of names, then how well the item fits the stock name's other parts.
      let best = 0, at = -1, bm = null;
      theirs.forEach((p, j) => { for (const m of mine) { const f = fit(st, m, p); if (f > best) { best = f; at = j; bm = m; } } });
      if (best <= 0) continue;
      // Another kind of the same thing: every word of the item is in it, and what it adds only says which
      // one (Mozzarella Block, Bella Bianca), not another kind of thing (powder, ice cream).
      const hit = (y) => bm.some((x) => sim(x, y) > 0);
      const kind = bm.every((x) => theirs[at].some((y) => sim(x, y) > 0)) && theirs[at].filter((y) => !hit(y)).every((y) => !SOFT.has(y) && !OTHER.has(y));
      let other = 0;
      theirs.forEach((p, j) => { if (j !== at) for (const m of mine) other = Math.max(other, fit(st, m, p)); });
      // Also how much of that stock name any of the item's names explain (Baklava Phyllo for "Baklava
      // pastry, Phyllo dough"), then the stock name's other language.
      const name = (0.85 * best + 0.15 * cover(st, all, theirs[at]) + 0.15 * other);
      let score = name;
      const why = [], warn = [];
      const theirSizes = sizes(o.name);
      if (mySizes.length && theirSizes.length) {
        if (mySizes.some((a) => theirSizes.some((b) => sameSize(a, b)))) { score += 0.15; why.push('size'); }
        else { score -= 0.15; warn.push('size'); }
      }
      if (ctx.supplier && Array.isArray(o.from) && o.from.some((f) => sameSupplier(ctx.supplier, f))) { score += 0.12; why.push('supplier'); }
      if (ctx.unit && Array.isArray(o.units) && o.units.length && S().unit(o.units.filter(Boolean), ctx.unit)) { score += 0.06; why.push('unit'); }
      if (Number(o.bought) > 0) { score += 0.04; why.push('bought'); }
      const other_ = ctx.taken && ctx.taken.get && ctx.taken.get(o.name);
      if (other_) { score -= 0.15; warn.push('taken'); }
      const ok = matches(item, o.name);
      if (!ok) { score -= 0.05; warn.push('name'); }
      out.push({ o, score, name, why, warn, matches: ok, taken: other_ || null, kind });
    }
    return out.sort((a, b) => b.score - a.score || String(a.o.name).localeCompare(String(b.o.name)));
  }

  /* The stock items worth suggesting for this ordering item, best first (at most n): a real fit by name
     (signals alone never suggest anything), and close enough to the best one that a wrong cousin
     (French Lettuce for French fries) isn't offered next to the right one. Both kinds are offered when
     there are two (two mozzarellas: a bit further from the best one is still offered). With full: the ranked results ({o, score, why, warn}). */
  const MIN_NAME = 0.34, MIN_SCORE = 0.4, NEAR = 0.15;
  function suggest(item, options, n = 4, ctx = {}, full = false) {
    const ranked = rank(item, options, ctx).filter((r) => r.name >= MIN_NAME && r.score >= MIN_SCORE);
    const top = ranked.length ? ranked[0].score : 0;
    const kept = ranked.filter((r) => r.score >= top - NEAR || (r.kind && r.score >= top - 2 * NEAR)).slice(0, n);
    return full ? kept : kept.map((r) => r.o);
  }
  /* A suggestion sure enough to link without looking at it twice: a clear fit by name, nothing that
     speaks against it, and well ahead of the next one. */
  function sure(results) {
    const [a, b] = results || [];
    return !!a && a.matches && !a.warn.length && a.score >= 0.72 && (!b || a.score - b.score >= 0.15);
  }

  /* How much of a stock item is in Main Storage, for the Order screen: a whole number (1 or more) of
     buying units shows in the buying unit, anything else in the counting unit (rounded down to 3
     decimals, like Stock). {qty, unit, empty} */
  function amount(titem) {
    const base = T().available(titem, MAIN);
    const buy = titem && titem.buy && titem.buy.name && Number(titem.buy.factor) > 0 ? titem.buy : null;
    if (buy && base > 0) {
      const n = base / Number(buy.factor);
      if (n >= 1 - 1e-9 && Math.abs(n - Math.round(n)) < 1e-6) return { qty: Math.round(n), unit: buy.name, empty: false };
    }
    const c = T().inCounting(titem, base, true);
    return { qty: c.qty, unit: c.unit, empty: !(base > 0) };
  }

  /* Low stock, one rule for the Order screen and Rico's low_stock: empty, or less than LOW_DAYS days
     left at the pace it left the storage in moved transfers over the last USE_DAYS days (at least 2
     moves; without them it is just in stock). */
  const LOW_DAYS = 3, USE_DAYS = 14;
  /* How much of each item left a storage: {name: {base, n}} from moved transfer rows (practice runs
     never count). */
  function usage(rows, titems, zone) {
    const byName = new Map((titems || []).map((i) => [i.name, i])), used = new Map();
    for (const r of rows || []) {
      if (!r || r.mode === 'practice' || (zone && r.from_zone !== zone)) continue;
      for (const l of r.lines || []) {
        const it = byName.get(l && l.item);
        if (!it) continue;
        const o = T().unitOptions(it).find((u) => u.name === l.unit);
        const q = Number(l.qty) * (o ? o.factor : l.unit === it.base ? 1 : 0);
        if (!(q > 0)) continue;
        const u = used.get(it.name) || { base: 0, n: 0 };
        u.base += q; u.n++; used.set(it.name, u);
      }
    }
    return used;
  }
  /* Days left (null without enough usage) and the level: 'empty', 'low' or 'ok'. */
  function level(titem, used, zone = MAIN) {
    const have = T().available(titem, zone), u = used && used.get(titem && titem.name);
    const perDay = u && u.n >= 2 ? u.base / USE_DAYS : 0;
    const days = perDay > 0 ? have / perDay : null;
    return { days, level: have <= 0 ? 'empty' : days !== null && days < LOW_DAYS ? 'low' : 'ok' };
  }

  globalThis.RicottaStockLink = Object.freeze({ MAIN, LOW_DAYS, USE_DAYS, words, matches, rank, suggest, sure, sameSupplier, amount, usage, level });
})();
