import { randomBytes } from "node:crypto";
import ExcelJS from "exceljs";
import {
  db,
  CHANNELS,
  CHANNEL_FIELDS,
  CHANNEL_ROLE,
  ROLE_FIELDS,
  seedChannels,
  calculate,
} from "./database.js";
import { hashPassword, verifyPassword, hashToken, userFor } from "./auth.js";
import {
  csvCell,
  parseCSV,
  seedAndExportRows,
  persistSku,
  addSnapshot,
  saveImported,
} from "./products.js";

const json = (res, status, obj, headers = {}) => {
  const data = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(data);
};
async function bodyJSON(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4_000_000) throw new Error("Request is too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new Error("Invalid JSON request");
  }
}
export async function handle(req, res) {
  const url = new URL(req.url, "http://localhost"),
    route = url.pathname;
  try {
    if (req.method === "GET" && route === "/api/auth/status")
      return json(res, 200, {
        setup_required: !db.prepare("SELECT 1 FROM users LIMIT 1").get(),
        user: userFor(req),
      });
    if (req.method === "POST" && ["/api/setup", "/api/login"].includes(route)) {
      const data = await bodyJSON(req),
        username = String(data.username ?? "")
          .trim()
          .toLowerCase(),
        password = String(data.password ?? ""),
        display = String(data.display_name || username).trim();
      if (username.length < 3 || password.length < 12)
        return json(res, 400, {
          error:
            "Use a username of at least 3 characters and a password of at least 12 characters.",
        });
      let userId;
      if (route === "/api/setup") {
        db.exec("BEGIN IMMEDIATE");
        try {
          if (db.prepare("SELECT 1 FROM users LIMIT 1").get()) {
            db.exec("ROLLBACK");
            return json(res, 409, {
              error: "Initial setup is already complete.",
            });
          }
          userId = Number(
            db
              .prepare(
                "INSERT INTO users(username,display_name,role,password_hash) VALUES(?,?,?,?)",
              )
              .run(username, display, "Admin", hashPassword(password))
              .lastInsertRowid,
          );
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          if (error.code === "SQLITE_CONSTRAINT_UNIQUE")
            return json(res, 409, { error: "Username already exists." });
          throw error;
        }
      } else {
        const row = db
          .prepare("SELECT * FROM users WHERE username=?")
          .get(username);
        if (!row || !verifyPassword(password, row.password_hash))
          return json(res, 401, { error: "Incorrect username or password." });
        userId = row.id;
      }
      const token = randomBytes(32).toString("base64url"),
        expires = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
      db.prepare(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
      ).run(hashToken(token), userId, expires);
      const user = db
        .prepare("SELECT id,username,display_name,role FROM users WHERE id=?")
        .get(userId);
      return json(
        res,
        200,
        { user },
        {
          "Set-Cookie": `mh_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`,
        },
      );
    }
    if (req.method === "POST" && route === "/api/logout") {
      const token = (req.headers.cookie || "")
        .split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("mh_session="))
        ?.split("=")
        .slice(1)
        .join("=");
      if (token)
        db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
          hashToken(token),
        );
      return json(
        res,
        200,
        { ok: true },
        {
          "Set-Cookie":
            "mh_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        },
      );
    }
    const user = userFor(req);
    if (!user) return json(res, 401, { error: "Sign in required" });
    if (req.method === "GET") {
      if (route === "/api/classification-settings")
        return json(
          res,
          200,
          Object.fromEntries(
            db
              .prepare("SELECT * FROM settings")
              .all()
              .map((r) => [r.key, JSON.parse(r.value)]),
          ),
        );
      if (route === "/api/skus")
        return json(
          res,
          200,
          db.prepare("SELECT * FROM skus ORDER BY updated_at DESC").all(),
        );
      if (route === "/api/channels") {
        const sid = Number(url.searchParams.get("sku_id") || 0),
          channel = url.searchParams.get("channel");
        let rows;
        if (sid) {
          seedChannels(sid);
          rows = db
            .prepare("SELECT * FROM channels WHERE sku_id=? ORDER BY channel")
            .all(sid);
        } else if (CHANNELS.includes(channel)) {
          for (const sku of db.prepare("SELECT id FROM skus").all())
            seedChannels(sku.id);
          rows = db
            .prepare("SELECT * FROM channels WHERE channel=? ORDER BY sku_id")
            .all(channel);
        } else
          return json(res, 400, { error: "Pass sku_id or a valid channel." });
        return json(res, 200, rows);
      }
      if (route === "/api/history")
        return json(
          res,
          200,
          db
            .prepare(
              "SELECT id,sku_id,period,version,actor,snapshot,metrics,created_at FROM history WHERE sku_id=? ORDER BY period DESC,version DESC",
            )
            .all(Number(url.searchParams.get("sku_id") || 0)),
        );
      if (route === "/api/audit") {
        if (!["Admin", "Finance", "Management"].includes(user.role))
          return json(res, 403, { error: "Not permitted" });
        return json(
          res,
          200,
          db
            .prepare(
              "SELECT a.*,s.sku FROM audit a JOIN skus s ON s.id=a.sku_id ORDER BY a.id DESC LIMIT 500",
            )
            .all(),
        );
      }
      if (route === "/api/users") {
        if (user.role !== "Admin")
          return json(res, 403, { error: "Admin access required" });
        return json(
          res,
          200,
          db
            .prepare(
              "SELECT id,username,display_name,role,created_at FROM users ORDER BY username",
            )
            .all(),
        );
      }
      if (route === "/api/settings") {
        if (user.role !== "Admin")
          return json(res, 403, { error: "Admin access required" });
        return json(
          res,
          200,
          Object.fromEntries(
            db
              .prepare("SELECT * FROM settings")
              .all()
              .map((r) => [r.key, JSON.parse(r.value)]),
          ),
        );
      }
      if (route === "/api/backup") {
        if (user.role !== "Admin")
          return json(res, 403, { error: "Admin access required" });
        const bytes = db.serialize();
        res.writeHead(200, {
          "Content-Type": "application/vnd.sqlite3",
          "Content-Length": bytes.length,
          "Content-Disposition": "attachment; filename=mason-home-backup.db",
          "Cache-Control": "no-store",
        });
        return res.end(Buffer.from(bytes));
      }
      if (route === "/api/export" || route === "/api/export.xlsx") {
        let rows;
        try {
          rows = seedAndExportRows(url.searchParams);
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
        const headers = rows.length ? Object.keys(rows[0]) : ["sku", "name"];
        if (route.endsWith(".xlsx")) {
          const wb = new ExcelJS.Workbook(),
            sheet = wb.addWorksheet("SKU Profitability");
          sheet.addRow(headers);
          sheet.views = [{ state: "frozen", ySplit: 1 }];
          rows.forEach((row) => sheet.addRow(headers.map((k) => row[k] ?? "")));
          sheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: Math.max(1, rows.length + 1), column: headers.length },
          };
          sheet.getRow(1).font = { bold: true };
          const bytes = await wb.xlsx.writeBuffer();
          res.writeHead(200, {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Length": bytes.byteLength,
            "Content-Disposition": "attachment; filename=mason-home-skus.xlsx",
            "Cache-Control": "no-store",
          });
          return res.end(Buffer.from(bytes));
        }
        const csv = [
          headers.map(csvCell).join(","),
          ...rows.map((row) =>
            headers
              .map((k) => {
                const v = csvCell(row[k]);
                return /[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
              })
              .join(","),
          ),
        ].join("\r\n");
        res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Length": Buffer.byteLength(csv),
          "Content-Disposition": "attachment; filename=mason-home-skus.csv",
          "Cache-Control": "no-store",
        });
        return res.end(csv);
      }
      return json(res, 404, { error: "Not found" });
    }
    if (req.method !== "POST")
      return json(res, 405, { error: "Method not allowed" });
    const data = await bodyJSON(req);
    if (route === "/api/users") {
      if (user.role !== "Admin")
        return json(res, 403, { error: "Admin access required" });
      const username = String(data.username ?? "")
          .trim()
          .toLowerCase(),
        display = String(data.display_name || username).trim(),
        password = String(data.password ?? ""),
        role = data.role;
      if (!Object.hasOwn(ROLE_FIELDS, role))
        return json(res, 400, { error: "Choose a valid role." });
      if (username.length < 3 || password.length < 12)
        return json(res, 400, {
          error:
            "Username must be at least 3 characters and password 12 characters.",
        });
      try {
        db.prepare(
          "INSERT INTO users(username,display_name,role,password_hash) VALUES(?,?,?,?)",
        ).run(username, display, role, hashPassword(password));
      } catch (e) {
        if (e.code === "SQLITE_CONSTRAINT_UNIQUE")
          return json(res, 409, { error: "Username already exists." });
        throw e;
      }
      return json(res, 201, { ok: true });
    }
    if (route === "/api/settings") {
      if (user.role !== "Admin")
        return json(res, 403, { error: "Admin access required" });
      if (data.weights) {
        const keys = [
            "demand_strength",
            "profitability",
            "demand_consistency",
            "quality_score",
            "inventory_efficiency",
          ],
          w = Object.fromEntries(keys.map((k) => [k, Number(data.weights[k])]));
        if (
          keys.some((k) => !Number.isFinite(w[k]) || w[k] < 0 || w[k] > 100) ||
          Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 100) > 0.001
        )
          return json(res, 400, {
            error: "Scoring weights must be 0–100 and total 100.",
          });
        db.prepare(
          "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        ).run("weights", JSON.stringify(w));
      }
      if (data.thresholds) {
        const bounds = {
            hero: [0, 100],
            low_margin: [0, 100],
            volume: [0, 100],
            new_launch_days: [0, 3650],
          },
          t = Object.fromEntries(
            Object.entries(bounds).map(([k]) => [
              k,
              Number(data.thresholds[k]),
            ]),
          );
        if (
          Object.entries(bounds).some(
            ([k, [lo, hi]]) => !Number.isFinite(t[k]) || t[k] < lo || t[k] > hi,
          )
        )
          return json(res, 400, {
            error: "Threshold values are outside their allowed range.",
          });
        db.prepare(
          "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        ).run("thresholds", JSON.stringify(t));
      }
      return json(res, 200, { ok: true });
    }
    if (route === "/api/skus") {
      try {
        return json(res, 200, persistSku(data, user));
      } catch (error) {
        return json(res, error.status || 400, { error: error.message });
      }
    }
    if (route === "/api/channels") {
      const skuId = Number(data.sku_id || 0),
        channel = data.channel;
      if (!CHANNELS.includes(channel))
        return json(res, 400, { error: "Invalid sales channel." });
      const allowed = CHANNEL_ROLE[user.role];
      if (!allowed.size)
        return json(res, 403, {
          error: "Your role cannot edit channel assumptions.",
        });
      if (
        user.role !== "Admin" &&
        user.role !== "Finance" &&
        ["commission_gst", "payment_gst", "shipping_gst", "packaging_gst"].some(
          (k) => Object.hasOwn(data, k),
        )
      )
        return json(res, 403, {
          error: "Only Finance or Admin may edit tax amounts.",
        });
      const forbidden = Object.keys(data).filter(
        (k) => CHANNEL_FIELDS.has(k) && !allowed.has(k),
      );
      if (forbidden.length)
        return json(res, 403, {
          error: "Your role cannot edit one or more channel fields.",
        });
      const entries = Object.entries(data).filter(([k]) =>
        CHANNEL_FIELDS.has(k),
      );
      for (let i = 0; i < entries.length; i++) {
        const [k, v] = entries[i],
          n = Number(v || 0);
        if (!Number.isFinite(n) || n < 0 || n >= 1e12)
          return json(res, 400, {
            error: `${k} must be a non-negative number.`,
          });
        entries[i] = [k, n];
        data[k] = n;
      }
      if (
        ["commission_rate", "payment_rate"].some(
          (k) => Object.hasOwn(data, k) && data[k] > 100,
        ) ||
        (Number(data.commission_rate) || 0) +
          (Number(data.payment_rate) || 0) >=
          100
      )
        return json(res, 400, {
          error: "Combined percentage fees must be below 100%.",
        });
      const sku = db.prepare("SELECT * FROM skus WHERE id=?").get(skuId);
      if (!sku) return json(res, 404, { error: "SKU not found." });
      seedChannels(skuId);
      seedChannels(skuId);
      const before = db
        .prepare("SELECT * FROM channels WHERE sku_id=? AND channel=?")
        .get(skuId, channel);
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const [k, v] of entries)
          db.prepare(
            `UPDATE channels SET "${k}"=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE sku_id=? AND channel=?`,
          ).run(v, user.username, skuId, channel);
        const after = db
          .prepare("SELECT * FROM channels WHERE sku_id=? AND channel=?")
          .get(skuId, channel);
        db.prepare(
          "INSERT INTO audit(sku_id,actor,action,changes) VALUES(?,?,?,?)",
        ).run(
          skuId,
          user.username,
          `channel update · ${channel}`,
          JSON.stringify(
            Object.fromEntries(
              entries.map(([k, v]) => [k, { old: before[k], new: v }]),
            ),
          ),
        );
        addSnapshot(
          skuId,
          user.username,
          { sku, channel: after },
          calculate({ ...sku, ...after }),
        );
        db.exec("COMMIT");
        return json(res, 200, after);
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
    if (route === "/api/import") {
      if (!["Admin", "Finance", "Buying"].includes(user.role))
        return json(res, 403, { error: "Your role cannot import SKUs." });
      let records;
      try {
        if (data.xlsx) {
          if (
            typeof data.xlsx !== "string" ||
            !/^[A-Za-z0-9+/]+=*$/.test(data.xlsx)
          )
            throw new Error("Invalid Excel file.");
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(Buffer.from(data.xlsx, "base64"));
          const sheet = wb.worksheets[0];
          if (!sheet) throw new Error("Excel workbook has no worksheets.");
          const headers = (sheet.getRow(1).values || [])
            .slice(1)
            .map((v) => String(v ?? "").trim());
          records = [];
          sheet.eachRow((row, index) => {
            if (index > 1) {
              const values = row.values.slice(1);
              records.push(
                Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""])),
              );
            }
          });
        } else records = parseCSV(String(data.csv ?? ""));
      } catch (error) {
        return json(res, 400, {
          error: `Unable to read import file: ${error.message}`,
        });
      }
      db.exec("SAVEPOINT bulk_import");
      let count = 0;
      try {
        for (const row of records) if (saveImported(row, user)) count++;
        db.exec("RELEASE bulk_import");
      } catch (error) {
        db.exec("ROLLBACK TO bulk_import");
        db.exec("RELEASE bulk_import");
        return json(res, 400, { error: error.message });
      }
      return json(res, 200, { ok: true, count });
    }
    return json(res, 404, { error: "Not found" });
  } catch (error) {
    if (!res.headersSent)
      json(res, error.status || 500, {
        error: error.status ? error.message : "Internal server error",
      });
    else res.destroy();
    if (error.status === undefined) console.error(error);
  }
}
