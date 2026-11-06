import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, pbkdf2Sync, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ExcelJS from 'exceljs';

const ROOT = import.meta.dirname;
for (const line of (() => { try { return readFileSync(resolve(ROOT, '.env.local'), 'utf8').split(/\r?\n/); } catch { return []; } })()) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (match && !match[1].startsWith('#')) process.env[match[1]] ??= match[2].replace(/^['"]|['"]$/g, '');
}
const configuredDb = (process.env.DATABASE_URL || 'file:./mason-home.db').replace(/^file:/, '');
const DB_PATH = resolve(ROOT, configuredDb);
mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys=ON');

const CHANNELS = ['Shopify', 'Amazon', 'Myntra', 'Nykaa', 'Tata Cliq', 'Ajio', 'Offline'];
const SKU_FIELDS = new Set(`sku name category subcategory supplier origin channel hsn gst mrp price seller_discount marketplace_discount purchase purchase_gst itc nonrecoverable freight insurance bcd sws import_igst clearance port local_transport other_procurement commission commission_rate commission_gst payment payment_rate payment_gst shipping shipping_gst packaging packaging_gst fulfilment returns other_variable advertising influencer campaign monthly_sales return_rate product_type demand_strength demand_consistency quality_score quality_override inventory_units lead_time_days days_cover gst_tcs income_tax_tds created_by`.split(' '));
const NUMERIC_FIELDS = new Set([...SKU_FIELDS].filter(k => !['sku','name','category','subcategory','supplier','origin','channel','hsn','product_type','created_by'].includes(k)));
const CHANNEL_FIELDS = new Set(`monthly_sales price mrp seller_discount marketplace_discount commission commission_rate commission_gst payment payment_rate payment_gst shipping shipping_gst packaging packaging_gst fulfilment returns other_variable advertising influencer campaign`.split(' '));
const ROLE_FIELDS = {
  Admin: SKU_FIELDS,
  Finance: new Set([...SKU_FIELDS].filter(k => !['demand_strength','demand_consistency','quality_score','quality_override','inventory_units','lead_time_days','days_cover','product_type','advertising','influencer','campaign'].includes(k))),
  Buying: new Set(`sku name category subcategory supplier origin channel product_type purchase freight insurance bcd sws clearance port local_transport other_procurement inventory_units lead_time_days days_cover monthly_sales`.split(' ')),
  Marketing: new Set(`sku name category subcategory channel price mrp seller_discount marketplace_discount monthly_sales return_rate advertising influencer campaign`.split(' ')),
  Management: new Set(),
};
const CHANNEL_ROLE = {
  Admin: CHANNEL_FIELDS,
  Finance: new Set([...CHANNEL_FIELDS].filter(k => !['advertising','influencer','campaign'].includes(k))),
  Buying: new Set(),
  Marketing: new Set(['monthly_sales','advertising','influencer','campaign']),
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
  const columns = table => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(x => x.name));
  const addMissing = (table, defs) => { const have = columns(table); for (const [name, type] of Object.entries(defs)) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`); };
  addMissing('skus', { product_type: "TEXT DEFAULT ''", commission_rate: 'REAL DEFAULT 0', payment_rate: 'REAL DEFAULT 0', demand_strength: 'REAL DEFAULT 50', demand_consistency: 'REAL DEFAULT 50', quality_score: 'REAL DEFAULT 50', quality_override: 'INTEGER DEFAULT 0', inventory_units: 'REAL DEFAULT 0', lead_time_days: 'REAL DEFAULT 0', days_cover: 'REAL DEFAULT 0', gst_tcs: 'REAL DEFAULT 0', income_tax_tds: 'REAL DEFAULT 0', created_by: "TEXT DEFAULT ''", created_at: 'TEXT' });
  db.exec('UPDATE skus SET created_at=updated_at WHERE created_at IS NULL');
  addMissing('channels', { commission_rate: 'REAL DEFAULT 0', payment_rate: 'REAL DEFAULT 0', monthly_sales: 'REAL DEFAULT 0' });
  const defaults = [
    ['weights', {demand_strength:25,profitability:30,demand_consistency:15,quality_score:15,inventory_efficiency:15}],
    ['thresholds', {hero:80,low_margin:15,volume:70,new_launch_days:90}],
  ];
  for (const [key,value] of defaults) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(key,JSON.stringify(value));
  db.exec('CREATE INDEX IF NOT EXISTS history_sku_period_idx ON history(sku_id,period)');
}

function currentPeriod() {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit'}).formatToParts(new Date());
  return `${parts.find(x=>x.type==='year').value}-${parts.find(x=>x.type==='month').value}`;
}
function calculate(d) {
  const rate=Math.max(0,Number(d.gst)||0)/100;
  const revenue=Math.max(0,(Number(d.price)||0)/(1+rate)-(Number(d.seller_discount)||0));
  const landed=['purchase','nonrecoverable','freight','insurance','bcd','sws','clearance','port','local_transport','other_procurement'].reduce((a,k)=>a+(Number(d[k])||0),0);
  const fixed=['commission','commission_gst','payment','payment_gst','shipping','shipping_gst','packaging','packaging_gst','fulfilment','returns','other_variable'].reduce((a,k)=>a+(Number(d[k])||0),0);
  const feeRate=((Number(d.commission_rate)||0)+(Number(d.payment_rate)||0))/100;
  const variable=fixed+revenue*feeRate;
  const marketing=['advertising','influencer','campaign'].reduce((a,k)=>a+(Number(d[k])||0),0);
  const gross=revenue-landed,before=gross-variable,after=before-marketing;
  const breakEven=(landed+fixed)/Math.max(.0001,1-feeRate)+(Number(d.seller_discount)||0);
  return {revenue,landed,gross,grossMargin:revenue?gross/revenue*100:0,variable,before,beforeMargin:revenue?before/revenue*100:0,marketing,after,afterMargin:revenue?after/revenue*100:0,breakEvenPrice:breakEven*(1+rate),monthly:after*(Number(d.monthly_sales)||0),itc:(Number(d.itc)||0)+(Number(d.import_igst)||0)};
}
const sample=calculate({gst:18,price:2360,purchase:700,commission:200,shipping:100,packaging:30,payment:20,returns:30,advertising:100});
if (sample.revenue!==2000||sample.gross!==1300||sample.before!==920||sample.after!==820||sample.afterMargin!==41) throw new Error(`Sample calculation failed: ${JSON.stringify(sample)}`);

function seedChannels(skuId) {
  const row=db.prepare('SELECT * FROM skus WHERE id=?').get(skuId); if (!row) return;
  const cols=[...CHANNEL_FIELDS]; const insert=db.prepare(`INSERT OR IGNORE INTO channels(sku_id,channel,${cols.join(',')},updated_by) VALUES(${['?','?',...cols.map(()=>'?'),'?'].join(',')})`);
  for (const channel of CHANNELS) insert.run(skuId,channel,...cols.map(k=>row[k]??0),row.updated_by||'System');
}
init();
function createMonthlySnapshots() {
  const period=currentPeriod();
  const has=db.prepare('SELECT 1 FROM history WHERE sku_id=? AND period=? LIMIT 1');
  const next=db.prepare('SELECT COALESCE(MAX(version),0)+1 AS version FROM history WHERE sku_id=? AND period=?');
  const insert=db.prepare('INSERT INTO history(sku_id,period,version,actor,snapshot,metrics) VALUES(?,?,?,?,?,?)');
  for (const row of db.prepare('SELECT * FROM skus').all()) {
    if (has.get(row.id,period)) continue;
    insert.run(row.id,period,next.get(row.id,period).version,'System',JSON.stringify(row),JSON.stringify(calculate(row)));
  }
}
createMonthlySnapshots();

const hashPassword=password=>{const salt=randomBytes(16);return `${salt.toString('hex')}:${pbkdf2Sync(password,salt,310000,32,'sha256').toString('hex')}`;};
function verifyPassword(password,stored) {
  const [saltHex,digestHex]=stored.split(':');const expected=Buffer.from(digestHex,'hex');const actual=pbkdf2Sync(password,Buffer.from(saltHex,'hex'),310000,32,'sha256');return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
const hashToken=token=>createHash('sha256').update(token).digest('hex');
const json=(res,status,obj,headers={})=>{const data=JSON.stringify(obj);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(data),'Cache-Control':'no-store',...headers});res.end(data);};
function userFor(req) {
  const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('mh_session='))?.split('=').slice(1).join('=');
  if(!token)return null;
  const row=db.prepare('SELECT u.id,u.username,u.display_name,u.role,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').get(hashToken(token));
  if(!row||Date.parse(row.expires_at)<=Date.now())return null;
  const {expires_at,...user}=row;return user;
}
async function bodyJSON(req) {
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>4_000_000)throw new Error('Request is too large');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw new Error('Invalid JSON request');}
}
const csvCell=value=>{const text=String(value??'');return /^[=+\-@\t\r]/.test(text)?`'${text}`:text;};
function parseCSV(text) {
  const records=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else cell+=ch;}
    else if(ch==='"')quoted=true;
    else if(ch===','){row.push(cell);cell='';}
    else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);records.push(row);row=[];cell='';}
    else cell+=ch;
  }
  if(cell||row.length){row.push(cell);records.push(row);}
  const headers=(records.shift()||[]).map(x=>x.trim());
  return records.filter(r=>r.some(x=>x!=='')).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
}
function seedAndExportRows(query) {
  const clauses=[],args=[],channel=query.get('channel');
  for(const key of ['category','supplier'])if(query.get(key)){clauses.push(channel?`s.${key}=?`:`${key}=?`);args.push(query.get(key));}
  let rows;
  if(channel){if(!CHANNELS.includes(channel))throw new Error('Invalid sales channel.');for(const sku of db.prepare('SELECT id FROM skus').all())seedChannels(sku.id);
    const channelCols=[...CHANNEL_FIELDS].map(k=>`c.${k} AS channel_${k}`).join(',');
    rows=db.prepare(`SELECT s.*,${channelCols} FROM skus s JOIN channels c ON c.sku_id=s.id${clauses.length?' WHERE '+[...clauses,'c.channel=?'].join(' AND '):' WHERE c.channel=?'} ORDER BY s.sku`).all(...args,channel);
    rows=rows.map(row=>{for(const key of CHANNEL_FIELDS){row[key]=row[`channel_${key}`];delete row[`channel_${key}`];}row.channel=channel;return row;});
  }else rows=db.prepare(`SELECT * FROM skus${clauses.length?' WHERE '+clauses.join(' AND '):''} ORDER BY sku`).all(...args);
  return rows.map(row=>{const m=calculate(row);return {...row,net_revenue:m.revenue,landed_cost:m.landed,gross_profit:m.gross,gross_margin_pct:m.grossMargin,contribution_before_marketing:m.before,contribution_after_marketing:m.after,contribution_margin_pct:m.afterMargin,monthly_contribution:m.after*(Number(row.monthly_sales)||0)};});
}
function persistSku(input,user) {
  const sku=String(input.sku??'').trim(),name=String(input.name??'').trim();
  if(!sku||!name)throw new Error('SKU code and product name are required.');
  if(sku.length>100||name.length>300)throw new Error('SKU code or product name is too long.');
  if(user.role==='Management')throw Object.assign(new Error('Management access is read-only.'),{status:403});
  const allowed=ROLE_FIELDS[user.role],old=db.prepare('SELECT * FROM skus WHERE sku=?').get(sku),before=old?{...old}:{};
  const forbidden=[...SKU_FIELDS].filter(k=>Object.hasOwn(input,k)&&!allowed.has(k)&&!['sku','name','created_by'].includes(k));
  if(old&&forbidden.some(k=>{const numeric=NUMERIC_FIELDS.has(k);return numeric?Number(input[k]||0)!==Number(old[k]||0):String(input[k]??'')!==String(old[k]??'');}))throw Object.assign(new Error('Your role cannot edit one or more changed fields.'),{status:403});
  const values=Object.fromEntries(Object.entries(input).filter(([k])=>allowed.has(k)&&SKU_FIELDS.has(k)&&k!=='created_by'));
  if(user.role==='Admin')for(const k of ['gst','hsn','itc','import_igst','purchase_gst','nonrecoverable'])if(Object.hasOwn(input,k))values[k]=input[k];
  if(!old)Object.assign(values,{sku,name,created_by:user.username});
  values.updated_by=user.username;
  for(const [k,v] of Object.entries(values))if(NUMERIC_FIELDS.has(k)){
    const n=Number(v||0);if(!Number.isFinite(n)||Math.abs(n)>=1e12)throw new Error(`${k} must be a valid number.`);values[k]=n;
  }
  for(const k of ['gst','purchase_gst','return_rate','commission_rate','payment_rate'])if(Object.hasOwn(values,k)&&(values[k]<0||values[k]>100))throw new Error('Tax and percentage rates must be between 0 and 100.');
  if([...NUMERIC_FIELDS].some(k=>Object.hasOwn(values,k)&&values[k]<0))throw new Error('Financial and inventory inputs cannot be negative.');
  for(const k of ['demand_strength','demand_consistency','quality_score'])if(Object.hasOwn(values,k)&&values[k]>100)throw new Error('Demand and quality scores must be between 0 and 100.');
  if(Object.hasOwn(values,'quality_override')&&![0,1].includes(values.quality_override))throw new Error('Quality override must be 0 or 1.');
  if((values.commission_rate||0)+(values.payment_rate||0)>=100)throw new Error('Combined percentage fees must be below 100%.');
  db.exec('BEGIN IMMEDIATE');
  try{
    let id;
    if(old){const entries=Object.entries(values).filter(([k])=>k!=='sku');if(entries.length)db.prepare(`UPDATE skus SET ${entries.map(([k])=>`"${k}"=?`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...entries.map(([,v])=>v),old.id);id=old.id;}
    else {const entries=Object.entries(values);id=Number(db.prepare(`INSERT INTO skus(${entries.map(([k])=>`"${k}"`).join(',')}) VALUES(${entries.map(()=>'?').join(',')})`).run(...entries.map(([,v])=>v)).lastInsertRowid);}
    const saved=db.prepare('SELECT * FROM skus WHERE id=?').get(id);seedChannels(id);
    const changes=old?Object.fromEntries(Object.keys(saved).filter(k=>before[k]!==saved[k]).map(k=>[k,{old:before[k],new:saved[k]}])):Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{old:null,new:v}]));
    db.prepare('INSERT INTO audit(sku_id,actor,action,changes) VALUES(?,?,?,?)').run(id,user.username,old?'update':'create',JSON.stringify(changes));
    addSnapshot(id,user.username,saved,calculate(saved));db.exec('COMMIT');return {...saved};
  }catch(error){db.exec('ROLLBACK');if(error.code==='SQLITE_CONSTRAINT_UNIQUE')throw Object.assign(new Error('That SKU code already exists.'),{status:409});throw error;}
}
function addSnapshot(id,actor,snapshot,metrics) {
  const period=currentPeriod(),version=db.prepare('SELECT COALESCE(MAX(version),0)+1 AS version FROM history WHERE sku_id=? AND period=?').get(id,period).version;
  db.prepare('INSERT INTO history(sku_id,period,version,actor,snapshot,metrics) VALUES(?,?,?,?,?,?)').run(id,period,version,actor,JSON.stringify(snapshot),JSON.stringify(metrics));
}
function saveImported(input,user) {
  const row=Object.fromEntries(Object.entries(input).filter(([k])=>SKU_FIELDS.has(k)||k==='updated_by'));
  const sku=String(row.sku??'').trim(),name=String(row.name??'').trim();if(!sku||!name)return false;
  const old=db.prepare('SELECT * FROM skus WHERE sku=?').get(sku),allowed=ROLE_FIELDS[user.role],values=Object.fromEntries(Object.entries(row).filter(([k])=>allowed.has(k)&&SKU_FIELDS.has(k)));
  Object.assign(values,{sku,name,updated_by:user.username});if(!old)values.created_by=user.username;
  for(const k of NUMERIC_FIELDS)if(Object.hasOwn(values,k)){const n=Number(values[k]||0);if(!Number.isFinite(n)||n<0||n>=1e12)throw new Error(`${k} is invalid.`);values[k]=n;}
  for(const k of ['gst','purchase_gst','return_rate','commission_rate','payment_rate'])if(Object.hasOwn(values,k)&&values[k]>100)throw new Error('Tax and percentage rates must be between 0 and 100.');
  if((values.commission_rate||0)+(values.payment_rate||0)>=100)throw new Error('Combined percentage fees must be below 100%.');
  const entries=Object.entries(values);let id;
  if(old){const changed=entries.filter(([k])=>k!=='sku');if(changed.length)db.prepare(`UPDATE skus SET ${changed.map(([k])=>`"${k}"=?`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...changed.map(([,v])=>v),old.id);id=old.id;}
  else id=Number(db.prepare(`INSERT INTO skus(${entries.map(([k])=>`"${k}"`).join(',')}) VALUES(${entries.map(()=>'?').join(',')})`).run(...entries.map(([,v])=>v)).lastInsertRowid);
  const saved=db.prepare('SELECT * FROM skus WHERE id=?').get(id);seedChannels(id);
  const changes=old?Object.fromEntries(Object.keys(saved).filter(k=>old[k]!==saved[k]).map(k=>[k,{old:old[k],new:saved[k]}])):Object.fromEntries(entries.map(([k,v])=>[k,{old:null,new:v}]));
  db.prepare('INSERT INTO audit(sku_id,actor,action,changes) VALUES(?,?,?,?)').run(id,user.username,'import',JSON.stringify(changes));addSnapshot(id,user.username,saved,calculate(saved));return true;
}

async function handle(req,res) {
  const url=new URL(req.url,'http://localhost'),route=url.pathname;
  try {
    if(req.method==='GET'&&route==='/'){const data=readFileSync(resolve(ROOT,'index.html'));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':data.length,'Cache-Control':'no-store'});return res.end(data);}
    if(req.method==='GET'&&route==='/api/auth/status')return json(res,200,{setup_required:!db.prepare('SELECT 1 FROM users LIMIT 1').get(),user:userFor(req)});
    if(req.method==='POST'&&['/api/setup','/api/login'].includes(route)){
      const data=await bodyJSON(req),username=String(data.username??'').trim().toLowerCase(),password=String(data.password??''),display=String(data.display_name||username).trim();
      if(username.length<3||password.length<12)return json(res,400,{error:'Use a username of at least 3 characters and a password of at least 12 characters.'});
      let userId;
      if(route==='/api/setup'){
        db.exec('BEGIN IMMEDIATE');
        try{if(db.prepare('SELECT 1 FROM users LIMIT 1').get()){db.exec('ROLLBACK');return json(res,409,{error:'Initial setup is already complete.'});}
          userId=Number(db.prepare('INSERT INTO users(username,display_name,role,password_hash) VALUES(?,?,?,?)').run(username,display,'Admin',hashPassword(password)).lastInsertRowid);db.exec('COMMIT');
        }catch(error){db.exec('ROLLBACK');if(error.code==='SQLITE_CONSTRAINT_UNIQUE')return json(res,409,{error:'Username already exists.'});throw error;}
      }else{const row=db.prepare('SELECT * FROM users WHERE username=?').get(username);if(!row||!verifyPassword(password,row.password_hash))return json(res,401,{error:'Incorrect username or password.'});userId=row.id;}
      const token=randomBytes(32).toString('base64url'),expires=new Date(Date.now()+12*60*60*1000).toISOString();db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hashToken(token),userId,expires);
      const user=db.prepare('SELECT id,username,display_name,role FROM users WHERE id=?').get(userId);
      return json(res,200,{user},{'Set-Cookie':`mh_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`});
    }
    if(req.method==='POST'&&route==='/api/logout'){
      const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('mh_session='))?.split('=').slice(1).join('=');if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
      return json(res,200,{ok:true},{'Set-Cookie':'mh_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
    }
    const user=userFor(req);if(!user)return json(res,401,{error:'Sign in required'});
    if(req.method==='GET'){
      if(route==='/api/classification-settings')return json(res,200,Object.fromEntries(db.prepare('SELECT * FROM settings').all().map(r=>[r.key,JSON.parse(r.value)])));
      if(route==='/api/skus')return json(res,200,db.prepare('SELECT * FROM skus ORDER BY updated_at DESC').all());
      if(route==='/api/channels'){
        const sid=Number(url.searchParams.get('sku_id')||0),channel=url.searchParams.get('channel');let rows;
        if(sid){seedChannels(sid);rows=db.prepare('SELECT * FROM channels WHERE sku_id=? ORDER BY channel').all(sid);}
        else if(CHANNELS.includes(channel)){for(const sku of db.prepare('SELECT id FROM skus').all())seedChannels(sku.id);rows=db.prepare('SELECT * FROM channels WHERE channel=? ORDER BY sku_id').all(channel);}
        else return json(res,400,{error:'Pass sku_id or a valid channel.'});
        return json(res,200,rows);
      }
      if(route==='/api/history')return json(res,200,db.prepare('SELECT id,sku_id,period,version,actor,snapshot,metrics,created_at FROM history WHERE sku_id=? ORDER BY period DESC,version DESC').all(Number(url.searchParams.get('sku_id')||0)));
      if(route==='/api/audit'){
        if(!['Admin','Finance','Management'].includes(user.role))return json(res,403,{error:'Not permitted'});
        return json(res,200,db.prepare('SELECT a.*,s.sku FROM audit a JOIN skus s ON s.id=a.sku_id ORDER BY a.id DESC LIMIT 500').all());
      }
      if(route==='/api/users'){
        if(user.role!=='Admin')return json(res,403,{error:'Admin access required'});
        return json(res,200,db.prepare('SELECT id,username,display_name,role,created_at FROM users ORDER BY username').all());
      }
      if(route==='/api/settings'){
        if(user.role!=='Admin')return json(res,403,{error:'Admin access required'});
        return json(res,200,Object.fromEntries(db.prepare('SELECT * FROM settings').all().map(r=>[r.key,JSON.parse(r.value)])));
      }
      if(route==='/api/backup'){
        if(user.role!=='Admin')return json(res,403,{error:'Admin access required'});
        const bytes=db.serialize();res.writeHead(200,{'Content-Type':'application/vnd.sqlite3','Content-Length':bytes.length,'Content-Disposition':'attachment; filename=mason-home-backup.db','Cache-Control':'no-store'});return res.end(Buffer.from(bytes));
      }
      if(route==='/api/export'||route==='/api/export.xlsx'){
        let rows;try{rows=seedAndExportRows(url.searchParams);}catch(error){return json(res,400,{error:error.message});}
        const headers=rows.length?Object.keys(rows[0]):['sku','name'];
        if(route.endsWith('.xlsx')){
          const wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet('SKU Profitability');sheet.addRow(headers);sheet.views=[{state:'frozen',ySplit:1}];
          rows.forEach(row=>sheet.addRow(headers.map(k=>row[k]??'')));
          sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,rows.length+1),column:headers.length}};
          sheet.getRow(1).font={bold:true};const bytes=await wb.xlsx.writeBuffer();res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Length':bytes.byteLength,'Content-Disposition':'attachment; filename=mason-home-skus.xlsx','Cache-Control':'no-store'});return res.end(Buffer.from(bytes));
        }
        const csv=[headers.map(csvCell).join(','),...rows.map(row=>headers.map(k=>{const v=csvCell(row[k]);return /[",\r\n]/.test(v)?`"${v.replaceAll('"','""')}"`:v;}).join(','))].join('\r\n');
        res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Length':Buffer.byteLength(csv),'Content-Disposition':'attachment; filename=mason-home-skus.csv','Cache-Control':'no-store'});return res.end(csv);
      }
      return json(res,404,{error:'Not found'});
    }
    if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
    const data=await bodyJSON(req);
    if(route==='/api/users'){
      if(user.role!=='Admin')return json(res,403,{error:'Admin access required'});
      const username=String(data.username??'').trim().toLowerCase(),display=String(data.display_name||username).trim(),password=String(data.password??''),role=data.role;
      if(!Object.hasOwn(ROLE_FIELDS,role))return json(res,400,{error:'Choose a valid role.'});
      if(username.length<3||password.length<12)return json(res,400,{error:'Username must be at least 3 characters and password 12 characters.'});
      try{db.prepare('INSERT INTO users(username,display_name,role,password_hash) VALUES(?,?,?,?)').run(username,display,role,hashPassword(password));}catch(e){if(e.code==='SQLITE_CONSTRAINT_UNIQUE')return json(res,409,{error:'Username already exists.'});throw e;}
      return json(res,201,{ok:true});
    }
    if(route==='/api/settings'){
      if(user.role!=='Admin')return json(res,403,{error:'Admin access required'});
      if(data.weights){const keys=['demand_strength','profitability','demand_consistency','quality_score','inventory_efficiency'],w=Object.fromEntries(keys.map(k=>[k,Number(data.weights[k])]));if(keys.some(k=>!Number.isFinite(w[k])||w[k]<0||w[k]>100)||Math.abs(Object.values(w).reduce((a,b)=>a+b,0)-100)>.001)return json(res,400,{error:'Scoring weights must be 0–100 and total 100.'});db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('weights',JSON.stringify(w));}
      if(data.thresholds){const bounds={hero:[0,100],low_margin:[0,100],volume:[0,100],new_launch_days:[0,3650]},t=Object.fromEntries(Object.entries(bounds).map(([k])=>[k,Number(data.thresholds[k])]));if(Object.entries(bounds).some(([k,[lo,hi]])=>!Number.isFinite(t[k])||t[k]<lo||t[k]>hi))return json(res,400,{error:'Threshold values are outside their allowed range.'});db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('thresholds',JSON.stringify(t));}
      return json(res,200,{ok:true});
    }
    if(route==='/api/skus'){
      try{return json(res,200,persistSku(data,user));}catch(error){return json(res,error.status||400,{error:error.message});}
    }
    if(route==='/api/channels'){
      const skuId=Number(data.sku_id||0),channel=data.channel;
      if(!CHANNELS.includes(channel))return json(res,400,{error:'Invalid sales channel.'});
      const allowed=CHANNEL_ROLE[user.role];if(!allowed.size)return json(res,403,{error:'Your role cannot edit channel assumptions.'});
      if(user.role!=='Admin'&&user.role!=='Finance'&&['commission_gst','payment_gst','shipping_gst','packaging_gst'].some(k=>Object.hasOwn(data,k)))return json(res,403,{error:'Only Finance or Admin may edit tax amounts.'});
      const forbidden=Object.keys(data).filter(k=>CHANNEL_FIELDS.has(k)&&!allowed.has(k));if(forbidden.length)return json(res,403,{error:'Your role cannot edit one or more channel fields.'});
      const entries=Object.entries(data).filter(([k])=>CHANNEL_FIELDS.has(k));
      for(let i=0;i<entries.length;i++){const [k,v]=entries[i],n=Number(v||0);if(!Number.isFinite(n)||n<0||n>=1e12)return json(res,400,{error:`${k} must be a non-negative number.`});entries[i]=[k,n];data[k]=n;}
      if(['commission_rate','payment_rate'].some(k=>Object.hasOwn(data,k)&&data[k]>100)||((Number(data.commission_rate)||0)+(Number(data.payment_rate)||0)>=100))return json(res,400,{error:'Combined percentage fees must be below 100%.'});
      const sku=db.prepare('SELECT * FROM skus WHERE id=?').get(skuId);if(!sku)return json(res,404,{error:'SKU not found.'});seedChannels(skuId);
      seedChannels(skuId);const before=db.prepare('SELECT * FROM channels WHERE sku_id=? AND channel=?').get(skuId,channel);
      db.exec('BEGIN IMMEDIATE');try{
        for(const [k,v] of entries)db.prepare(`UPDATE channels SET "${k}"=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE sku_id=? AND channel=?`).run(v,user.username,skuId,channel);
        const after=db.prepare('SELECT * FROM channels WHERE sku_id=? AND channel=?').get(skuId,channel);
        db.prepare('INSERT INTO audit(sku_id,actor,action,changes) VALUES(?,?,?,?)').run(skuId,user.username,`channel update · ${channel}`,JSON.stringify(Object.fromEntries(entries.map(([k,v])=>[k,{old:before[k],new:v}]))));
        addSnapshot(skuId,user.username,{sku,channel:after},calculate({...sku,...after}));db.exec('COMMIT');return json(res,200,after);
      }catch(error){db.exec('ROLLBACK');throw error;}
    }
    if(route==='/api/import'){
      if(!['Admin','Finance','Buying'].includes(user.role))return json(res,403,{error:'Your role cannot import SKUs.'});
      let records;
      try{
        if(data.xlsx){if(typeof data.xlsx!=='string'||!/^[A-Za-z0-9+/]+=*$/.test(data.xlsx))throw new Error('Invalid Excel file.');const wb=new ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(data.xlsx,'base64'));const sheet=wb.worksheets[0];if(!sheet)throw new Error('Excel workbook has no worksheets.');const headers=(sheet.getRow(1).values||[]).slice(1).map(v=>String(v??'').trim());records=[];sheet.eachRow((row,index)=>{if(index>1){const values=row.values.slice(1);records.push(Object.fromEntries(headers.map((h,i)=>[h,values[i]??''])));}});}
        else records=parseCSV(String(data.csv??''));
      }catch(error){return json(res,400,{error:`Unable to read import file: ${error.message}`});}
      db.exec('SAVEPOINT bulk_import');let count=0;try{for(const row of records)if(saveImported(row,user))count++;db.exec('RELEASE bulk_import');}catch(error){db.exec('ROLLBACK TO bulk_import');db.exec('RELEASE bulk_import');return json(res,400,{error:error.message});}
      return json(res,200,{ok:true,count});
    }
    return json(res,404,{error:'Not found'});
  } catch(error) {
    if(!res.headersSent)json(res,error.status||500,{error:error.status?error.message:'Internal server error'});else res.destroy();
    if(error.status===undefined)console.error(error);
  }
}

const port=Number(process.env.PORT||8000);
createServer((req,res)=>{void handle(req,res);}).listen(port,'127.0.0.1',()=>console.log(`Mason Home at http://localhost:${port} · SQLite: ${DB_PATH}`));
