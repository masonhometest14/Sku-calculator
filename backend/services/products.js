import {
  db,
  CHANNELS,
  SKU_FIELDS,
  NUMERIC_FIELDS,
  CHANNEL_FIELDS,
  ROLE_FIELDS,
  currentPeriod,
  calculate,
  seedChannels,
} from "./database.js";

export const csvCell = (value) => {
  const text = String(value ?? "");
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
};
export function parseCSV(text) {
  const records = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      records.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    records.push(row);
  }
  const headers = (records.shift() || []).map((x) => x.trim());
  return records
    .filter((r) => r.some((x) => x !== ""))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}
export function seedAndExportRows(query) {
  const clauses = [],
    args = [],
    channel = query.get("channel");
  for (const key of ["category", "supplier"])
    if (query.get(key)) {
      clauses.push(channel ? `s.${key}=?` : `${key}=?`);
      args.push(query.get(key));
    }
  let rows;
  if (channel) {
    if (!CHANNELS.includes(channel)) throw new Error("Invalid sales channel.");
    for (const sku of db.prepare("SELECT id FROM skus").all())
      seedChannels(sku.id);
    const channelCols = [...CHANNEL_FIELDS]
      .map((k) => `c.${k} AS channel_${k}`)
      .join(",");
    rows = db
      .prepare(
        `SELECT s.*,${channelCols} FROM skus s JOIN channels c ON c.sku_id=s.id${clauses.length ? " WHERE " + [...clauses, "c.channel=?"].join(" AND ") : " WHERE c.channel=?"} ORDER BY s.sku`,
      )
      .all(...args, channel);
    rows = rows.map((row) => {
      for (const key of CHANNEL_FIELDS) {
        row[key] = row[`channel_${key}`];
        delete row[`channel_${key}`];
      }
      row.channel = channel;
      return row;
    });
  } else
    rows = db
      .prepare(
        `SELECT * FROM skus${clauses.length ? " WHERE " + clauses.join(" AND ") : ""} ORDER BY sku`,
      )
      .all(...args);
  return rows.map((row) => {
    const m = calculate(row);
    return {
      ...row,
      net_revenue: m.revenue,
      landed_cost: m.landed,
      gross_profit: m.gross,
      gross_margin_pct: m.grossMargin,
      contribution_before_marketing: m.before,
      contribution_after_marketing: m.after,
      contribution_margin_pct: m.afterMargin,
      monthly_contribution: m.after * (Number(row.monthly_sales) || 0),
    };
  });
}
export function persistSku(input, user) {
  const sku = String(input.sku ?? "").trim(),
    name = String(input.name ?? "").trim();
  if (!sku || !name) throw new Error("SKU code and product name are required.");
  if (sku.length > 100 || name.length > 300)
    throw new Error("SKU code or product name is too long.");
  if (user.role === "Management")
    throw Object.assign(new Error("Management access is read-only."), {
      status: 403,
    });
  const allowed = ROLE_FIELDS[user.role],
    old = db.prepare("SELECT * FROM skus WHERE sku=?").get(sku),
    before = old ? { ...old } : {};
  const forbidden = [...SKU_FIELDS].filter(
    (k) =>
      Object.hasOwn(input, k) &&
      !allowed.has(k) &&
      !["sku", "name", "created_by"].includes(k),
  );
  if (
    old &&
    forbidden.some((k) => {
      const numeric = NUMERIC_FIELDS.has(k);
      return numeric
        ? Number(input[k] || 0) !== Number(old[k] || 0)
        : String(input[k] ?? "") !== String(old[k] ?? "");
    })
  )
    throw Object.assign(
      new Error("Your role cannot edit one or more changed fields."),
      { status: 403 },
    );
  const values = Object.fromEntries(
    Object.entries(input).filter(
      ([k]) => allowed.has(k) && SKU_FIELDS.has(k) && k !== "created_by",
    ),
  );
  if (user.role === "Admin")
    for (const k of [
      "gst",
      "hsn",
      "itc",
      "import_igst",
      "purchase_gst",
      "nonrecoverable",
    ])
      if (Object.hasOwn(input, k)) values[k] = input[k];
  if (!old) Object.assign(values, { sku, name, created_by: user.username });
  values.updated_by = user.username;
  for (const [k, v] of Object.entries(values))
    if (NUMERIC_FIELDS.has(k)) {
      const n = Number(v || 0);
      if (!Number.isFinite(n) || Math.abs(n) >= 1e12)
        throw new Error(`${k} must be a valid number.`);
      values[k] = n;
    }
  for (const k of [
    "gst",
    "purchase_gst",
    "return_rate",
    "commission_rate",
    "payment_rate",
  ])
    if (Object.hasOwn(values, k) && (values[k] < 0 || values[k] > 100))
      throw new Error("Tax and percentage rates must be between 0 and 100.");
  if (
    [...NUMERIC_FIELDS].some((k) => Object.hasOwn(values, k) && values[k] < 0)
  )
    throw new Error("Financial and inventory inputs cannot be negative.");
  for (const k of ["demand_strength", "demand_consistency", "quality_score"])
    if (Object.hasOwn(values, k) && values[k] > 100)
      throw new Error("Demand and quality scores must be between 0 and 100.");
  if (
    Object.hasOwn(values, "quality_override") &&
    ![0, 1].includes(values.quality_override)
  )
    throw new Error("Quality override must be 0 or 1.");
  if ((values.commission_rate || 0) + (values.payment_rate || 0) >= 100)
    throw new Error("Combined percentage fees must be below 100%.");
  db.exec("BEGIN IMMEDIATE");
  try {
    let id;
    if (old) {
      const entries = Object.entries(values).filter(([k]) => k !== "sku");
      if (entries.length)
        db.prepare(
          `UPDATE skus SET ${entries.map(([k]) => `"${k}"=?`).join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        ).run(...entries.map(([, v]) => v), old.id);
      id = old.id;
    } else {
      const entries = Object.entries(values);
      id = Number(
        db
          .prepare(
            `INSERT INTO skus(${entries.map(([k]) => `"${k}"`).join(",")}) VALUES(${entries.map(() => "?").join(",")})`,
          )
          .run(...entries.map(([, v]) => v)).lastInsertRowid,
      );
    }
    const saved = db.prepare("SELECT * FROM skus WHERE id=?").get(id);
    seedChannels(id);
    const changes = old
      ? Object.fromEntries(
          Object.keys(saved)
            .filter((k) => before[k] !== saved[k])
            .map((k) => [k, { old: before[k], new: saved[k] }]),
        )
      : Object.fromEntries(
          Object.entries(values).map(([k, v]) => [k, { old: null, new: v }]),
        );
    db.prepare(
      "INSERT INTO audit(sku_id,actor,action,changes) VALUES(?,?,?,?)",
    ).run(
      id,
      user.username,
      old ? "update" : "create",
      JSON.stringify(changes),
    );
    addSnapshot(id, user.username, saved, calculate(saved));
    db.exec("COMMIT");
    return { ...saved };
  } catch (error) {
    db.exec("ROLLBACK");
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE")
      throw Object.assign(new Error("That SKU code already exists."), {
        status: 409,
      });
    throw error;
  }
}
export function addSnapshot(id, actor, snapshot, metrics) {
  const period = currentPeriod(),
    version = db
      .prepare(
        "SELECT COALESCE(MAX(version),0)+1 AS version FROM history WHERE sku_id=? AND period=?",
      )
      .get(id, period).version;
  db.prepare(
    "INSERT INTO history(sku_id,period,version,actor,snapshot,metrics) VALUES(?,?,?,?,?,?)",
  ).run(
    id,
    period,
    version,
    actor,
    JSON.stringify(snapshot),
    JSON.stringify(metrics),
  );
}
export function saveImported(input, user) {
  const row = Object.fromEntries(
    Object.entries(input).filter(
      ([k]) => SKU_FIELDS.has(k) || k === "updated_by",
    ),
  );
  const sku = String(row.sku ?? "").trim(),
    name = String(row.name ?? "").trim();
  if (!sku || !name) return false;
  const old = db.prepare("SELECT * FROM skus WHERE sku=?").get(sku),
    allowed = ROLE_FIELDS[user.role],
    values = Object.fromEntries(
      Object.entries(row).filter(([k]) => allowed.has(k) && SKU_FIELDS.has(k)),
    );
  Object.assign(values, { sku, name, updated_by: user.username });
  if (!old) values.created_by = user.username;
  for (const k of NUMERIC_FIELDS)
    if (Object.hasOwn(values, k)) {
      const n = Number(values[k] || 0);
      if (!Number.isFinite(n) || n < 0 || n >= 1e12)
        throw new Error(`${k} is invalid.`);
      values[k] = n;
    }
  for (const k of [
    "gst",
    "purchase_gst",
    "return_rate",
    "commission_rate",
    "payment_rate",
  ])
    if (Object.hasOwn(values, k) && values[k] > 100)
      throw new Error("Tax and percentage rates must be between 0 and 100.");
  if ((values.commission_rate || 0) + (values.payment_rate || 0) >= 100)
    throw new Error("Combined percentage fees must be below 100%.");
  const entries = Object.entries(values);
  let id;
  if (old) {
    const changed = entries.filter(([k]) => k !== "sku");
    if (changed.length)
      db.prepare(
        `UPDATE skus SET ${changed.map(([k]) => `"${k}"=?`).join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      ).run(...changed.map(([, v]) => v), old.id);
    id = old.id;
  } else
    id = Number(
      db
        .prepare(
          `INSERT INTO skus(${entries.map(([k]) => `"${k}"`).join(",")}) VALUES(${entries.map(() => "?").join(",")})`,
        )
        .run(...entries.map(([, v]) => v)).lastInsertRowid,
    );
  const saved = db.prepare("SELECT * FROM skus WHERE id=?").get(id);
  seedChannels(id);
  const changes = old
    ? Object.fromEntries(
        Object.keys(saved)
          .filter((k) => old[k] !== saved[k])
          .map((k) => [k, { old: old[k], new: saved[k] }]),
      )
    : Object.fromEntries(entries.map(([k, v]) => [k, { old: null, new: v }]));
  db.prepare(
    "INSERT INTO audit(sku_id,actor,action,changes) VALUES(?,?,?,?)",
  ).run(id, user.username, "import", JSON.stringify(changes));
  addSnapshot(id, user.username, saved, calculate(saved));
  return true;
}
