const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const state = {
  lang: "en",
  account: "rozha",
  cart: {},
  items: [
    {
      id: "i1",
      name: "Tomatoes",
      unit: "kg",
      supplierId: "s1",
      available: false,
      aliases: ["tomato"],
    },
  ],
  units: [{ id: "kg", en: "kg", ku: "کیلۆ" }],
  suppliers: [{ id: "s1", name: "Market", phone: "07501234567" }],
};
const ctx = {
  T: { en: {}, ku: {}, ar: {} },
  state,
  window: {},
  foldText: (v) =>
    String(v)
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660),
  outboxJobId: () => String(Math.random()),
  supplierName: (id) => state.suppliers.find((s) => s.id === id)?.name || "",
  unitLabel: (id) => id,
  esc: (v) => String(v).replace(/</g, "&lt;"),
  lset: () => true,
  t: (k) => ctx.T[state.lang][k] || k,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("ordering-tools.js", "utf8"), ctx);
assert.equal(ctx.readQuantity("٠٫٥"), 0.5);
assert.equal(ctx.readQuantity("1,25"), 1.25);
assert.equal(ctx.validOrderQuantity(0.125), true);
assert.equal(ctx.validOrderQuantity(0.0001), false);
assert.deepEqual(
  JSON.parse(JSON.stringify(ctx.parseAliases("tomato, tomato، تماتە"))),
  ["tomato", "تماتە"],
);
assert.equal(
  ctx.previewImportRows([
    { Name: "Tomatoes", Unit: "kg", Supplier: "Market" },
  ])[0].item.available,
  false,
  "omitted availability preserves an existing item",
);
assert.ok(
  ctx.previewImportRows([{ Name: "X", Unit: "unknown", Supplier: "Market" }])[0]
    .error,
);
assert.ok(
  ctx.previewImportRows([
    { Name: "New", Unit: "kg", Supplier: "Market" },
    { Name: "New", Unit: "kg", Supplier: "Market" },
  ])[1].error,
);
assert.equal(
  ctx.previewImportRows([
    {
      Name: "New",
      Unit: "kg",
      Supplier: "Market",
      Available: "false",
      Aliases: "a,b",
    },
  ])[0].item.available,
  false,
);
assert.equal(
  ctx.previewImportRows([
    { Name: "New", Unit: "kg", Supplier: "Market", Available: "maybe" },
  ])[0].error,
  ctx.t("importError"),
);
state.suppliers.push({ id: "s2", name: "Market" });
assert.ok(ctx.previewImportRows([{ Name: "New", Unit: "kg", Supplier: "Market" }])[0].error, "ambiguous suppliers cannot be guessed");
assert.equal(ctx.previewImportRows([{ Name: "New", Unit: "kg", Supplier: "s1" }])[0].error, "");
state.suppliers.pop();
for (const lang of ["ku", "ar"])
  assert.deepEqual(
    Object.keys(ctx.T[lang]).sort(),
    Object.keys(ctx.T.en).sort(),
    "all helper labels are translated",
  );
const sheet = {};
vm.createContext(sheet);
vm.runInContext(fs.readFileSync("vendor/xlsx-0.20.3.min.js", "utf8"), sheet);
const reader = sheet.XLSX,
  book = reader.utils.book_new();
reader.utils.book_append_sheet(
  book,
  reader.utils.json_to_sheet([
    { Name: "تماتە", Unit: "kg", Supplier: "Market" },
  ]),
  "Items",
);
const file = reader.write(book, { type: "array", bookType: "xlsx" }),
  restored = reader.read(file, {
    type: "array",
    sheetRows: 502,
    cellFormula: false,
  });
assert.equal(
  reader.utils.sheet_to_json(restored.Sheets.Items)[0].Name,
  "تماتە",
  "real Excel files preserve Kurdish",
);
console.log(
  "Ordering tools: PASS (fractional/localized quantities, aliases, import validation, omitted values, duplicate rows, translations and real XLSX roundtrip)",
);
