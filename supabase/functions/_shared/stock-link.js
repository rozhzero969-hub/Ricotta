/* Ordering items linked to Ricotta Restaurant's stock items: one set of rules for the app and the API.
   Rozh links each ordering item to a stock item herself (Manage, edit an item). A link is only allowed
   when the names really match, so Mozzarella can never be linked to Banana. The Order screen then shows
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
  function words(name) {
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

  globalThis.RicottaStockLink = Object.freeze({ MAIN, words, matches, amount });
})();
