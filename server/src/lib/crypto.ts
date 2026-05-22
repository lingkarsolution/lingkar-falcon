import { randomBytes, createHash, scryptSync, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import { config } from '../config.js';

export const newId = (prefix = 'id'): string =>
  `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

export const sha256 = (s: string): string =>
  createHash('sha256').update(s).digest('hex');

export const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
};

export const verifyPassword = (password: string, stored: string): boolean => {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64).toString('hex');
  return candidate === hash;
};

export const newSessionToken = (): string => randomBytes(32).toString('hex');

// AES-256-GCM round-trip using a derived key from SESSION_SECRET.
// Credentials at rest are encrypted; secrets never returned to frontend.
const secretKey = (): Buffer => createHash('sha256').update(config.sessionSecret).digest();

export const encrypt = (plaintext: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
};

export const decrypt = (payload: string): string => {
  const [ivB, tagB, encB] = payload.split('.');
  const iv = Buffer.from(ivB!, 'base64');
  const tag = Buffer.from(tagB!, 'base64');
  const enc = Buffer.from(encB!, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
};
