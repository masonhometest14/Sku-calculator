import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
for (const line of (() => {
  try {
    return readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/);
  } catch {
    return [];
  }
})()) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (match && !match[1].startsWith("#"))
    process.env[match[1]] ??= match[2].replace(/^['"]|['"]$/g, "");
}
const configuredDb = (
  process.env.DATABASE_URL || "file:./mason-home.db"
).replace(/^file:/, "");
export const DB_PATH = resolve(ROOT, configuredDb);
mkdirSync(dirname(DB_PATH), { recursive: true });
export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys=ON");

export const CHANNELS = [
  "Shopify",
  "Amazon",
  "Myntra",
  "Nykaa",
  "Tata Cliq",
  "Ajio",
  "Offline",
];
export const SKU_FIELDS = new Set(
  `sku name category subcategory supplier origin channel hsn gst mrp price seller_discount marketplace_discount purchase purchase_gst itc nonrecoverable freight insurance bcd sws import_igst clearance port local_transport other_procurement commission commission_rate commission_gst payment payment_rate payment_gst shipping shipping_gst packaging packaging_gst fulfilment returns other_variable advertising influencer campaign monthly_sales return_rate product_type demand_strength demand_consistency quality_score quality_override inventory_units lead_time_days days_cover gst_tcs income_tax_tds created_by`.split(
    " ",
  ),
);
export const NUMERIC_FIELDS = new Set(
  [...SKU_FIELDS].filter(
    (k) =>
      ![
        "sku",
        "name",
        "category",
        "subcategory",
        "supplier",
        "origin",
        "channel",
        "hsn",
        "product_type",
        "created_by",
      ].includes(k),
  ),
);
export const CHANNEL_FIELDS = new Set(
  `monthly_sales price mrp seller_discount marketplace_discount commission commission_rate commission_gst payment payment_rate payment_gst shipping shipping_gst packaging packaging_gst fulfilment returns other_variable advertising influencer campaign`.split(
    " ",
  ),
);
export const ROLE_FIELDS = {
  Admin: SKU_FIELDS,
  Finance: new Set(
    [...SKU_FIELDS].filter(
      (k) =>
        ![
          "demand_strength",
          "demand_consistency",
          "quality_score",
          "quality_override",
          "inventory_units",
          "lead_time_days",
          "days_cover",
          "product_type",
          "advertising",
          "influencer",
          "campaign",
        ].includes(k),
    ),
  ),
  Buying: new Set(
    `sku name category subcategory supplier origin channel product_type purchase freight insurance bcd sws clearance port local_transport other_procurement inventory_units lead_time_days days_cover monthly_sales`.split(
      " ",
    ),
  ),
  Marketing: new Set(
    `sku name category subcategory channel price mrp seller_discount marketplace_discount monthly_sales return_rate advertising influencer campaign`.split(
      " ",
    ),
  ),
  Management: new Set(),
};
export const CHANNEL_ROLE = {
  Admin: CHANNEL_FIELDS,
  Finance: new Set(
    [...CHANNEL_FIELDS].filter(
      (k) => !["advertising", "influencer", "campaign"].includes(k),
    ),
  ),
  Buying: new Set(),
  Marketing: new Set([
    "monthly_sales",
    "advertising",
    "influencer",
    "campaign",
  ]),
  Management: new Set(),
};

function init() {
  db.exec(`CREATE TABLE IF NOT EXISTS skus (
    id INTEGER PRIMARY KEY, sku TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    category TEXT DEFAULT '', subcategory TEXT DEFAULT '', supplier TEXT DEFAULT '',
    origin TEXT DEFAULT 'Domestic', channel TEXT DEFAULT 'Shopify', hsn TEXT DEFAULT '',
    gst REAL DEFAULT 18, mrp REAL DEFAULT 0, price REAL DEFAULT 0, seller_discount REAL DEFAULT 0,
    marketplace_discount REAL DEFAULT 0, purchase REAL DEFAULT 0, purchase_gst REAL DEFAULT 0,
    itc REAL DEFAULT 0, nonrecoverable REAL DEFAULT 0, freight REAL DEFAULT 0, insurance REAL DEFAULT 0,
    bcd REAL DEFAULT 0, sws REAL DEFAULT 0, import_igst REAL DEFAULT 0, clearance REAL DEFAULT 0,
    port REAL DEFAULT 0, local_transport REAL DEFAULT 0, other_procurement REAL DEFAULT 0,
    commission REAL DEFAULT 0, commission_rate REAL DEFAULT 0, commission_gst REAL DEFAULT 0,
    payment REAL DEFAULT 0, payment_rate REAL DEFAULT 0, payment_gst REAL DEFAULT 0,
    shipping REAL DEFAULT 0, shipping_gst REAL DEFAULT 0, packaging REAL DEFAULT 0,
    packaging_gst REAL DEFAULT 0, fulfilment REAL DEFAULT 0, returns REAL DEFAULT 0,
    other_variable REAL DEFAULT 0, advertising REAL DEFAULT 0, influencer REAL DEFAULT 0,
    campaign REAL DEFAULT 0, monthly_sales REAL DEFAULT 0, return_rate REAL DEFAULT 0,
    product_type TEXT DEFAULT '', demand_strength REAL DEFAULT 50, demand_consistency REAL DEFAULT 50,
    quality_score REAL DEFAULT 50, quality_override INTEGER DEFAULT 0, inventory_units REAL DEFAULT 0,
    lead_time_days REAL DEFAULT 0, days_cover REAL DEFAULT 0, gst_tcs REAL DEFAULT 0,
    income_tax_tds REAL DEFAULT 0, created_by TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_by TEXT DEFAULT 'Admin', updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS channels(id INTEGER PRIMARY KEY, sku_id INTEGER NOT NULL REFERENCES skus(id) ON DELETE CASCADE, channel TEXT NOT NULL, monthly_sales REAL DEFAULT 0, price REAL DEFAULT 0, mrp REAL DEFAULT 0, seller_discount REAL DEFAULT 0, marketplace_discount REAL DEFAULT 0, commission REAL DEFAULT 0, commission_rate REAL DEFAULT 0, commission_gst REAL DEFAULT 0, payment REAL DEFAULT 0, payment_rate REAL DEFAULT 0, payment_gst REAL DEFAULT 0, shipping REAL DEFAULT 0, shipping_gst REAL DEFAULT 0, packaging REAL DEFAULT 0, packaging_gst REAL DEFAULT 0, fulfilment REAL DEFAULT 0, returns REAL DEFAULT 0, other_variable REAL DEFAULT 0, advertising REAL DEFAULT 0, influencer REAL DEFAULT 0, campaign REAL DEFAULT 0, updated_by TEXT DEFAULT '', updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(sku_id,channel));
    CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY, sku_id INTEGER NOT NULL REFERENCES skus(id), period TEXT NOT NULL, version INTEGER NOT NULL, actor TEXT NOT NULL, snapshot TEXT NOT NULL, metrics TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, sku_id INTEGER NOT NULL REFERENCES skus(id), actor TEXT NOT NULL, action TEXT NOT NULL, changes TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const columns = (table) =>
    new Set(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((x) => x.name),
    );
  const addMissing = (table, defs) => {
    const have = columns(table);
    for (const [name, type] of Object.entries(defs))
      if (!have.has(name))
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  };
  addMissing("skus", {
    product_type: "TEXT DEFAULT ''",
    commission_rate: "REAL DEFAULT 0",
    payment_rate: "REAL DEFAULT 0",
    demand_strength: "REAL DEFAULT 50",
    demand_consistency: "REAL DEFAULT 50",
    quality_score: "REAL DEFAULT 50",
    quality_override: "INTEGER DEFAULT 0",
    inventory_units: "REAL DEFAULT 0",
    lead_time_days: "REAL DEFAULT 0",
    days_cover: "REAL DEFAULT 0",
    gst_tcs: "REAL DEFAULT 0",
    income_tax_tds: "REAL DEFAULT 0",
    created_by: "TEXT DEFAULT ''",
    created_at: "TEXT",
  });
  db.exec("UPDATE skus SET created_at=updated_at WHERE created_at IS NULL");
  addMissing("channels", {
    commission_rate: "REAL DEFAULT 0",
    payment_rate: "REAL DEFAULT 0",
    monthly_sales: "REAL DEFAULT 0",
  });
  const defaults = [
    [
      "weights",
      {
        demand_strength: 25,
        profitability: 30,
        demand_consistency: 15,
        quality_score: 15,
        inventory_efficiency: 15,
      },
    ],
    [
      "thresholds",
      { hero: 80, low_margin: 15, volume: 70, new_launch_days: 90 },
    ],
  ];
  for (const [key, value] of defaults)
    db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)").run(
      key,
      JSON.stringify(value),
    );
  db.exec(
    "CREATE INDEX IF NOT EXISTS history_sku_period_idx ON history(sku_id,period)",
  );
}

export function currentPeriod() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((x) => x.type === "year").value}-${parts.find((x) => x.type === "month").value}`;
}
export function calculate(d) {
  const rate = Math.max(0, Number(d.gst) || 0) / 100;
  const revenue = Math.max(
    0,
    (Number(d.price) || 0) / (1 + rate) - (Number(d.seller_discount) || 0),
  );
  const landed = [
    "purchase",
    "nonrecoverable",
    "freight",
    "insurance",
    "bcd",
    "sws",
    "clearance",
    "port",
    "local_transport",
    "other_procurement",
  ].reduce((a, k) => a + (Number(d[k]) || 0), 0);
  const fixed = [
    "commission",
    "commission_gst",
    "payment",
    "payment_gst",
    "shipping",
    "shipping_gst",
    "packaging",
    "packaging_gst",
    "fulfilment",
    "returns",
    "other_variable",
  ].reduce((a, k) => a + (Number(d[k]) || 0), 0);
  const feeRate =
    ((Number(d.commission_rate) || 0) + (Number(d.payment_rate) || 0)) / 100;
  const variable = fixed + revenue * feeRate;
  const marketing = ["advertising", "influencer", "campaign"].reduce(
    (a, k) => a + (Number(d[k]) || 0),
    0,
  );
  const gross = revenue - landed,
    before = gross - variable,
    after = before - marketing;
  const breakEven =
    (landed + fixed) / Math.max(0.0001, 1 - feeRate) +
    (Number(d.seller_discount) || 0);
  return {
    revenue,
    landed,
    gross,
    grossMargin: revenue ? (gross / revenue) * 100 : 0,
    variable,
    before,
    beforeMargin: revenue ? (before / revenue) * 100 : 0,
    marketing,
    after,
    afterMargin: revenue ? (after / revenue) * 100 : 0,
    breakEvenPrice: breakEven * (1 + rate),
    monthly: after * (Number(d.monthly_sales) || 0),
    itc: (Number(d.itc) || 0) + (Number(d.import_igst) || 0),
  };
}
const sample = calculate({
  gst: 18,
  price: 2360,
  purchase: 700,
  commission: 200,
  shipping: 100,
  packaging: 30,
  payment: 20,
  returns: 30,
  advertising: 100,
});
if (
  sample.revenue !== 2000 ||
  sample.gross !== 1300 ||
  sample.before !== 920 ||
  sample.after !== 820 ||
  sample.afterMargin !== 41
)
  throw new Error(`Sample calculation failed: ${JSON.stringify(sample)}`);

export function seedChannels(skuId) {
  const row = db.prepare("SELECT * FROM skus WHERE id=?").get(skuId);
  if (!row) return;
  const cols = [...CHANNEL_FIELDS];
  const insert = db.prepare(
    `INSERT OR IGNORE INTO channels(sku_id,channel,${cols.join(",")},updated_by) VALUES(${["?", "?", ...cols.map(() => "?"), "?"].join(",")})`,
  );
  for (const channel of CHANNELS)
    insert.run(
      skuId,
      channel,
      ...cols.map((k) => row[k] ?? 0),
      row.updated_by || "System",
    );
}
init();
function createMonthlySnapshots() {
  const period = currentPeriod();
  const has = db.prepare(
    "SELECT 1 FROM history WHERE sku_id=? AND period=? LIMIT 1",
  );
  const next = db.prepare(
    "SELECT COALESCE(MAX(version),0)+1 AS version FROM history WHERE sku_id=? AND period=?",
  );
  const insert = db.prepare(
    "INSERT INTO history(sku_id,period,version,actor,snapshot,metrics) VALUES(?,?,?,?,?,?)",
  );
  for (const row of db.prepare("SELECT * FROM skus").all()) {
    if (has.get(row.id, period)) continue;
    insert.run(
      row.id,
      period,
      next.get(row.id, period).version,
      "System",
      JSON.stringify(row),
      JSON.stringify(calculate(row)),
    );
  }
}
createMonthlySnapshots();
