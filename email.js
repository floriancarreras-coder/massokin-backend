const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

// L'adresse d'envoi DOIT appartenir à un domaine vérifié dans Resend.
// Voir README.md, section "Configurer Resend".
const FROM_ADDRESS = process.env.EMAIL_FROM || "Massokin <cadeaux@massokin.com>";
const REPLY_TO = process.env.EMAIL_REPLY_TO || "contact@massokin.com";

/**
 * Envoie le certificat-cadeau au destinataire (PDF en pièce jointe).
 */
async function sendGiftEmailToRecipient({
  recipientEmail,
  recipientName,
  buyerName,
  productLabel,
  personalMessage,
  pdfBytes,
}) {
  const messageBlock = personalMessage
    ? `<p style="font-style:italic;color:#4a5450;margin:16px 0;padding:14px 16px;background:#F6F1E7;border-radius:10px;">« ${escapeHtml(
        personalMessage
      )} »</p>`
    : "";

  const html = `
    <div style="font-family: Georgia, 'Times New Roman', serif; max-width:560px; margin:0 auto; color:#1A1F1C;">
      <h1 style="font-size:22px; color:#1B3326; margin-bottom:4px;">Vous avez reçu un cadeau 🎁</h1>
      <p style="font-family: Arial, sans-serif; font-size:15px; color:#4A5450; line-height:1.6;">
        Bonjour ${escapeHtml(recipientName)},<br><br>
        <strong>${escapeHtml(buyerName)}</strong> vous offre :
      </p>
      <p style="font-family: Arial, sans-serif; font-size:17px; font-weight:bold; color:#1B3326;">
        ${escapeHtml(productLabel)}
      </p>
      ${messageBlock}
      <p style="font-family: Arial, sans-serif; font-size:14px; color:#4A5450; line-height:1.6;">
        Votre certificat est joint à ce courriel en PDF — vous n'avez qu'à le présenter
        (imprimé ou sur votre téléphone) lors de votre rendez-vous.
      </p>
      <p style="font-family: Arial, sans-serif; font-size:14px; color:#4A5450;">
        Pour réserver : <a href="tel:+14388775135" style="color:#1B3326;">438 877-5135</a>
        ou <a href="https://www.massokin.com" style="color:#1B3326;">www.massokin.com</a>
      </p>
    </div>
  `;

  return resend.emails.send({
    from: FROM_ADDRESS,
    to: recipientEmail,
    reply_to: REPLY_TO,
    subject: `${buyerName} vous offre un cadeau — Massokin`,
    html,
    attachments: [
      {
        filename: "certificat-cadeau-massokin.pdf",
        content: Buffer.from(pdfBytes).toString("base64"),
      },
    ],
  });
}

/**
 * Envoie une confirmation d'achat à l'acheteur.
 * - Si c'est un cadeau : confirmation simple (le PDF est déjà parti au destinataire).
 * - Si ce n'est pas un cadeau (forfait pour soi-même) : le PDF est joint ici.
 */
async function sendPurchaseConfirmation({
  buyerEmail,
  buyerName,
  productLabel,
  isGift,
  recipientName,
  pdfBytes,
}) {
  const html = isGift
    ? `
      <div style="font-family: Arial, sans-serif; max-width:560px; margin:0 auto; color:#1A1F1C;">
        <h1 style="font-size:20px; color:#1B3326;">Merci pour votre achat !</h1>
        <p style="font-size:15px; color:#4A5450; line-height:1.6;">
          Bonjour ${escapeHtml(buyerName)},<br><br>
          Votre paiement pour <strong>${escapeHtml(productLabel)}</strong> a bien été reçu.
          Le certificat-cadeau a été envoyé directement à ${escapeHtml(recipientName)}.
        </p>
        <p style="font-size:13px; color:#8A8F8C;">Merci de votre confiance — Massokin</p>
      </div>
    `
    : `
      <div style="font-family: Arial, sans-serif; max-width:560px; margin:0 auto; color:#1A1F1C;">
        <h1 style="font-size:20px; color:#1B3326;">Merci pour votre achat !</h1>
        <p style="font-size:15px; color:#4A5450; line-height:1.6;">
          Bonjour ${escapeHtml(buyerName)},<br><br>
          Votre paiement pour <strong>${escapeHtml(productLabel)}</strong> a bien été reçu.
          Votre certificat est joint à ce courriel — présentez-le lors de votre rendez-vous.
        </p>
        <p style="font-size:14px; color:#4A5450;">
          Pour réserver : <a href="tel:+14388775135" style="color:#1B3326;">438 877-5135</a>
        </p>
        <p style="font-size:13px; color:#8A8F8C;">Merci de votre confiance — Massokin</p>
      </div>
    `;

  const payload = {
    from: FROM_ADDRESS,
    to: buyerEmail,
    reply_to: REPLY_TO,
    subject: "Confirmation de votre achat — Massokin",
    html,
  };

  if (!isGift && pdfBytes) {
    payload.attachments = [
      {
        filename: "certificat-massokin.pdf",
        content: Buffer.from(pdfBytes).toString("base64"),
      },
    ];
  }

  return resend.emails.send(payload);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = { sendGiftEmailToRecipient, sendPurchaseConfirmation };
