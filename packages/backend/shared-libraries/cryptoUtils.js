const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function getKey() {
    const k = process.env.REGISTRATION_KEY;
    if (!k) throw new Error('REGISTRATION_KEY not set');
    return crypto.createHash('sha256').update(k).digest();
}

function encrypt(text) {
    const key = getKey();
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(b64) {
    const raw = Buffer.from(b64, 'base64');
    const iv = raw.slice(0, IV_LEN);
    const tag = raw.slice(IV_LEN, IV_LEN + 16);
    const encrypted = raw.slice(IV_LEN + 16);
    const key = getKey();
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return out.toString('utf8');
}

module.exports = { encrypt, decrypt };
