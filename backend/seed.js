import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ROOT = import.meta.dirname;
for (const line of (() => { try { return readFileSync(resolve(ROOT, '.env.local'), 'utf8').split(/\r?\n/); } catch { return []; } })()) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (match && !match[1].startsWith('#')) process.env[match[1]] ??= match[2].replace(/^['"]|['"]$/g, '');
}
const DB_PATH = resolve(ROOT, (process.env.DATABASE_URL || 'file:./mason-home.db').replace(/^file:/, ''));
mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS skus (
  id INTEGER PRIMARY KEY, sku TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  category TEXT DEFAULT '', subcategory TEXT DEFAULT '', supplier TEXT DEFAULT '',
  origin TEXT DEFAULT 'Domestic', channel TEXT DEFAULT 'Shopify', gst REAL DEFAULT 18,
  mrp REAL DEFAULT 0, price REAL DEFAULT 0, purchase REAL DEFAULT 0, commission REAL DEFAULT 0,
  shipping REAL DEFAULT 0, packaging REAL DEFAULT 0, payment REAL DEFAULT 0, returns REAL DEFAULT 0,
  advertising REAL DEFAULT 0, monthly_sales REAL DEFAULT 0, return_rate REAL DEFAULT 0,
  demand_strength REAL DEFAULT 50, demand_consistency REAL DEFAULT 50, quality_score REAL DEFAULT 50,
  quality_override INTEGER DEFAULT 0, inventory_units REAL DEFAULT 0, updated_by TEXT DEFAULT 'Admin',
  created_by TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
const products = [
  ['MH-DEMO-001','Ceramic Table Lamp','Lighting','Table lamps','Clay & Co','Domestic','Amazon',2999,2360,700,200,100,30,20,30,100,120,42,360,18,22,28,0,24],
  ['MH-DEMO-002','Linen Cushion Cover','Home textiles','Cushion covers','Loom House','Domestic','Shopify',1299,999,260,95,55,18,14,20,45,210,58,900,12,35,42,0,18],
  ['MH-DEMO-003','Brass Table Clock','Decor','Clocks','Northstar Living','Import','Myntra',3499,2999,860,280,130,45,28,35,120,65,25,150,26,17,31,0,42],
  ['MH-DEMO-004','Acacia Serving Board','Kitchen','Serveware','Wildwood Studio','Domestic','Tata Cliq',1899,1599,480,145,75,25,18,25,60,88,36,240,15,29,37,0,30],
  ['MH-DEMO-005','Ribbed Glass Vase','Decor','Vases','Form & Field','Import','Ajio',2299,1799,540,170,90,35,18,28,80,52,19,110,30,14,25,0,48],
  ['MH-DEMO-006','Cotton Bath Towel Set','Bath','Towels','Loom House','Domestic','Nykaa',1599,1399,390,120,60,20,16,22,55,165,51,660,10,38,45,0,20],
  ['MH-DEMO-007','Woven Storage Basket','Storage','Baskets','Earthcraft','Domestic','Offline',999,899,240,0,0,12,0,15,25,130,64,520,8,46,50,0,16],
  ['MH-DEMO-008','Pendant Ceiling Light','Lighting','Pendant lights','Clay & Co','Import','Amazon',4999,3999,1180,360,155,55,35,45,180,42,21,88,34,12,26,0,55],
];
const insert = db.prepare(`INSERT OR IGNORE INTO skus(sku,name,category,subcategory,supplier,origin,channel,gst,mrp,price,purchase,commission,shipping,packaging,payment,returns,advertising,monthly_sales,return_rate,demand_strength,demand_consistency,quality_score,quality_override,inventory_units,updated_by,created_by)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
db.exec('BEGIN IMMEDIATE');
try {
  for (const p of products) insert.run(p[0],p[1],p[2],p[3],p[4],p[5],p[6],18,p[7],p[8],p[9],p[10],p[11],p[12],p[13],p[14],p[15],p[16],p[17],p[18],p[19],p[20],p[21],p[22],'Demo data','Demo data');
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}
console.log(`Seeded ${products.length} demo products (existing SKU codes were left unchanged).`);
