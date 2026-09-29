// Solo backend (node:crypto). NO se exporta desde index.ts para no arrastrarlo al bundle web.
// Importar con "@aviso/core/src/phoneCrypto.js".
// Claves en SSM SecureString (creadas a mano, nunca en el repo):
//   /aviso-andino/<stage>/secrets/phoneHmacKey  (base64, 32 bytes) -> phoneHash
//   /aviso-andino/<stage>/secrets/phoneEncKey   (base64, 32 bytes) -> phoneEnc "aes:"
// Se usa AES-256-GCM con clave en SSM en vez de una CMK de KMS (1 USD/mes) para el MVP.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const PHONE_PE = /^\+519\d{8}$/;

function keyFrom(base64: string, label: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error(`${label}: se esperaban 32 bytes`);
  return key;
}

export function hashPhone(phone: string, hmacKeyBase64: string): string {
  const digest = createHmac("sha256", keyFrom(hmacKeyBase64, "phoneHmacKey"))
    .update(phone.trim())
    .digest("hex");
  return `hmac256:${digest}`;
}

export function encryptPhone(phone: string, encKeyBase64: string): string {
  if (!PHONE_PE.test(phone)) throw new Error("Teléfono inválido");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(encKeyBase64, "phoneEncKey"), iv);
  const ciphertext = Buffer.concat([cipher.update(phone, "utf8"), cipher.final()]);
  return `aes:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
}

export function decryptPhone(phoneEnc: string, encKeyBase64: string): string {
  if (!phoneEnc.startsWith("aes:")) throw new Error("phoneEnc no es aes:");
  const raw = Buffer.from(phoneEnc.slice(4), "base64");
  if (raw.length < 29) throw new Error("phoneEnc corrupto");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyFrom(encKeyBase64, "phoneEncKey"),
    raw.subarray(0, 12),
  );
  decipher.setAuthTag(raw.subarray(12, 28));
  const phone = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  if (!PHONE_PE.test(phone)) throw new Error("Teléfono descifrado inválido");
  return phone;
}
