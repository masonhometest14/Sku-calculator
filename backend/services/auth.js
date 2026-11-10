import {
  randomBytes,
  pbkdf2Sync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { db } from "./database.js";

export const hashPassword = (password) => {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${pbkdf2Sync(password, salt, 310000, 32, "sha256").toString("hex")}`;
};
export function verifyPassword(password, stored) {
  const [saltHex, digestHex] = stored.split(":");
  const expected = Buffer.from(digestHex, "hex");
  const actual = pbkdf2Sync(
    password,
    Buffer.from(saltHex, "hex"),
    310000,
    32,
    "sha256",
  );
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export const hashToken = (token) =>
  createHash("sha256").update(token).digest("hex");

export function userFor(req) {
  const token = (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("mh_session="))
    ?.split("=")
    .slice(1)
    .join("=");
  if (!token) return null;
  const row = db
    .prepare(
      "SELECT u.id,u.username,u.display_name,u.role,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?",
    )
    .get(hashToken(token));
  if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
  const { expires_at, ...user } = row;
  return user;
}
