import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENC_VERSION = "v1";
const IV_LENGTH = 12;

function getSecretBase(): string {
  return String(process.env.SESSION_SECRET ?? "change-me").trim();
}

function getKey(): Buffer {
  return createHash("sha256").update(getSecretBase(), "utf8").digest();
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(IV_LENGTH);
  const key = getKey();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENC_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}

export function decryptSecret(payload: string): string {
  const [version, ivPart, tagPart, encPart] = payload.split(":");
  if (version !== ENC_VERSION || !ivPart || !tagPart || !encPart) {
    throw new Error("Invalid encrypted payload");
  }

  const key = getKey();
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const encrypted = Buffer.from(encPart, "base64url");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
