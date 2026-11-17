/* The colours a recipe category can have: ten soft pairings, each a pastel background with a deeper
   tone of the same colour for text and marks, and the same pair for dark mode. One list for the app
   (the tile behind a recipe's photo or letter, the colour card in Rico's chat), the API (a new category
   gets the next one not in use; Rico can only set one of these) and the Lab.
   The names are also the values the database accepts (app_recipe_categories.color): a new colour
   needs a migration that widens that check. */
(function () {
  const PALETTE = Object.freeze([
    { key: 'mint',    bg: '#DDF3E6', ink: '#1F6B46', bgDark: '#1C3529', inkDark: '#8FDDB4' },
    { key: 'butter',  bg: '#FBF0C4', ink: '#7A5B00', bgDark: '#3A3115', inkDark: '#EBCF72' },
    { key: 'peach',   bg: '#FDE3D3', ink: '#99461C', bgDark: '#3D271C', inkDark: '#F3B08C' },
    { key: 'sky',     bg: '#DCEBFB', ink: '#1F5A93', bgDark: '#1B2C3F', inkDark: '#93C2F1' },
    { key: 'lilac',   bg: '#E9E2F8', ink: '#5B3F9E', bgDark: '#2B2540', inkDark: '#BDA9EE' },
    { key: 'rose',    bg: '#FBE0E6', ink: '#9C2F4C', bgDark: '#3C2129', inkDark: '#F2A3B7' },
    { key: 'sand',    bg: '#F1E8DA', ink: '#6E5530', bgDark: '#332C21', inkDark: '#D9C29B' },
    { key: 'sage',    bg: '#E3EBDD', ink: '#49603A', bgDark: '#273024', inkDark: '#B4CBA3' },
    { key: 'apricot', bg: '#FDE8C8', ink: '#8A5200', bgDark: '#3B2D17', inkDark: '#F0C27E' },
    { key: 'mist',    bg: '#E4EAEE', ink: '#44586A', bgDark: '#262D33', inkDark: '#AFC0CE' },
  ].map(Object.freeze));
  const KEYS = Object.freeze(PALETTE.map((c) => c.key));
  const get = (key) => PALETTE.find((c) => c.key === key) || null;
  /* The colour a new category gets: the first one no category uses yet; once all ten are in use, the
     one used least (the earliest of those). */
  function next(used) {
    const count = new Map(KEYS.map((k) => [k, 0]));
    for (const k of used || []) if (count.has(k)) count.set(k, count.get(k) + 1);
    return KEYS.reduce((best, k) => (count.get(k) < count.get(best) ? k : best), KEYS[0]);
  }
  /* A colour somebody named ("yellow", "زەرد", "أصفر", "Butter"): the palette key, or null. Rico is told
     the ten names, so this only catches everyday words for them. */
  const WORDS = {
    mint: ['mint', 'green', 'light green', 'سەوز', 'نەعنا', 'أخضر', 'اخضر', 'نعناعي'],
    butter: ['butter', 'yellow', 'زەرد', 'کەرە', 'أصفر', 'اصفر'],
    peach: ['peach', 'orange', 'قۆخ', 'پرتەقاڵی', 'خوخي', 'برتقالي'],
    sky: ['sky', 'blue', 'light blue', 'شین', 'ئاسمانی', 'أزرق', 'ازرق', 'سماوي'],
    lilac: ['lilac', 'purple', 'violet', 'lavender', 'مۆر', 'بنفسجي', 'ليلكي'],
    rose: ['rose', 'pink', 'red', 'پەمەیی', 'سوور', 'وردي', 'زهري', 'أحمر', 'احمر'],
    sand: ['sand', 'beige', 'brown', 'cream', 'لم', 'قاوەیی', 'بێژ', 'رملي', 'بيج', 'بني'],
    sage: ['sage', 'olive', 'زەیتوونی', 'زيتوني', 'مريمي'],
    apricot: ['apricot', 'amber', 'gold', 'قەیسی', 'زێڕین', 'مشمشي', 'ذهبي'],
    mist: ['mist', 'grey', 'gray', 'silver', 'خۆڵەمێشی', 'تەم', 'رمادي', 'ضبابي'],
  };
  const fold = (s) => String(s ?? '').toLowerCase().normalize('NFKC').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim();
  function find(word) {
    const w = fold(word);
    if (!w) return null;
    if (KEYS.includes(w)) return w;
    for (const k of KEYS) if (WORDS[k].some((x) => fold(x) === w)) return k;
    return null;
  }
  globalThis.RicottaRecipeColors = Object.freeze({ PALETTE, KEYS, get, next, find });
})();
