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
// Excel for the workplace stock system: its names, units and amounts; the same item twice is one row.
state.units.push({ id: "box", en: "box", ku: "سندوق" });
state.items.push(
  { id: "i2", name: "تەماتە", unit: "box", supplierId: "s1", stockName: "Tomato - تەماتە", stockUnit: "kg", stockFactor: 20 },
  { id: "i3", name: "Basil", unit: "kg", supplierId: "s1" },
);
const transfer = ctx.stockTransferRows([
  { supplierId: "s1", items: [
    { itemId: "i2", name: "تەماتە", unit: "box", qty: 2 },
    { itemId: "i3", name: "Basil", unit: "kg", qty: 1.5 },
    { itemId: "gone", name: "Old item", unit: "kg", qty: 1 },
  ] },
  { supplierId: "s1", items: [{ itemId: "i2", name: "تەماتە", unit: "box", qty: 0.5 }] },
]);
assert.deepEqual(JSON.parse(JSON.stringify(transfer)), [
  { name: "Tomato - تەماتە", amount: 50, unit: "کیلۆ" },
  { name: "Basil", amount: 1.5, unit: "کیلۆ" },
  { name: "Old item", amount: 1, unit: "کیلۆ" },
], "stock rows use the stock system's name, unit and amount and combine repeats");
assert.equal(ctx.stockTransferRows([{ items: [{ itemId: "i3", name: "Basil", unit: "kg", qty: 0 }] }]).length, 0, "empty lines are left out");
console.log(
  "Ordering tools: PASS (fractional/localized quantities, aliases, import validation, omitted values, duplicate rows, translations, stock Excel rows and real XLSX roundtrip)",
);
