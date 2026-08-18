const Database = require("better-sqlite3");
const path = require("path");

// Le fichier .db est créé automatiquement au premier lancement.
// ATTENTION : sur la plupart des hébergeurs (Render, Railway) le disque
// est éphémère sauf si tu configures un "persistent disk" — voir README.md,
// section 7, pour ce point important.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "massokin.db");

const fs = require("fs");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS certificates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    certificate_code TEXT UNIQUE NOT NULL,
    stripe_session_id TEXT,
    product_key TEXT NOT NULL,
    product_label TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    is_gift INTEGER NOT NULL,
    buyer_name TEXT NOT NULL,
    buyer_email TEXT NOT NULL,
    recipient_name TEXT,
    recipient_email TEXT,
    personal_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    redeemed_at TEXT,
    redeemed_note TEXT
  );
`);

/**
 * Enregistre une vente confirmée avec son certificat.
 */
function saveCertificate({
  certificateCode,
  stripeSessionId,
  productKey,
  productLabel,
  amountCents,
  isGift,
  buyerName,
  buyerEmail,
  recipientName,
  recipientEmail,
  personalMessage,
}) {
  const stmt = db.prepare(`
    INSERT INTO certificates (
      certificate_code, stripe_session_id, product_key, product_label,
      amount_cents, is_gift, buyer_name, buyer_email,
      recipient_name, recipient_email, personal_message
    ) VALUES (
      @certificateCode, @stripeSessionId, @productKey, @productLabel,
      @amountCents, @isGift, @buyerName, @buyerEmail,
      @recipientName, @recipientEmail, @personalMessage
    )
  `);

  stmt.run({
    certificateCode,
    stripeSessionId: stripeSessionId || null,
    productKey,
    productLabel,
    amountCents,
    isGift: isGift ? 1 : 0,
    buyerName,
    buyerEmail,
    recipientName: recipientName || null,
    recipientEmail: recipientEmail || null,
    personalMessage: personalMessage || null,
  });
}

/**
 * Récupère un certificat par son code (insensible à la casse/espaces).
 */
function getCertificateByCode(code) {
  const normalized = String(code || "").trim().toUpperCase();
  return db
    .prepare(`SELECT * FROM certificates WHERE certificate_code = ?`)
    .get(normalized);
}

/**
 * Marque un certificat comme utilisé (à appeler quand le client
 * se présente en clinique pour son rendez-vous).
 */
function redeemCertificate(code, note) {
  const normalized = String(code || "").trim().toUpperCase();
  const result = db
    .prepare(
      `UPDATE certificates
       SET redeemed_at = datetime('now'), redeemed_note = ?
       WHERE certificate_code = ? AND redeemed_at IS NULL`
    )
    .run(note || null, normalized);
  return result.changes > 0; // true si effectivement marqué (pas déjà utilisé)
}

/**
 * Liste les ventes récentes (utile pour un futur tableau de bord admin).
 */
function listRecentCertificates(limit = 50) {
  return db
    .prepare(`SELECT * FROM certificates ORDER BY created_at DESC LIMIT ?`)
    .all(limit);
}

module.exports = {
  saveCertificate,
  getCertificateByCode,
  redeemCertificate,
  listRecentCertificates,
};
