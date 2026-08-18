const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");

// Palette inspirée du site (forêt / crème / sauge)
const COLORS = {
  forest: rgb(0x1b / 255, 0x33 / 255, 0x26 / 255),
  cream: rgb(0xf6 / 255, 0xf1 / 255, 0xe7 / 255),
  sage: rgb(0x7b / 255, 0xa4 / 255, 0x7c / 255),
  ink: rgb(0x1a / 255, 0x1f / 255, 0x1c / 255),
  body: rgb(0x4a / 255, 0x54 / 255, 0x50 / 255),
  line: rgb(0xe3 / 255, 0xdc / 255, 0xcb / 255),
};

/**
 * Formate une date ISO (YYYY-MM-DD) en format long français.
 */
function formatDateFr(isoDate) {
  if (!isoDate) return "";
  const d = new Date(isoDate + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Centre du texte horizontalement sur la page.
 */
function drawCentered(page, text, { y, font, size, color }) {
  const width = font.widthOfTextAtSize(text, size);
  const pageWidth = page.getSize().width;
  page.drawText(text, {
    x: (pageWidth - width) / 2,
    y,
    size,
    font,
    color,
  });
}

/**
 * Génère un certificat-cadeau PDF (format paysage, une page).
 *
 * @param {Object} params
 * @param {string} params.productLabel - ex: "Certificat cadeau — Détente 60 min"
 * @param {string} params.recipientName
 * @param {string} params.buyerName - la personne qui offre
 * @param {string} [params.personalMessage]
 * @param {string} [params.deliveryDate] - ISO date, optionnel
 * @param {string} params.certificateCode - identifiant unique à présenter en rendez-vous
 * @returns {Promise<Uint8Array>} bytes du PDF
 */
async function generateGiftCertificate({
  productLabel,
  recipientName,
  buyerName,
  personalMessage,
  certificateCode,
}) {
  const pdfDoc = await PDFDocument.create();

  // Format paysage, type carte-cadeau (environ 11" x 8.5" en points)
  const page = pdfDoc.addPage([792, 612]);
  const { width, height } = page.getSize();

  const serif = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const serifItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const sansBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Fond crème
  page.drawRectangle({ x: 0, y: 0, width, height, color: COLORS.cream });

  // Cadre décoratif
  const margin = 28;
  page.drawRectangle({
    x: margin,
    y: margin,
    width: width - margin * 2,
    height: height - margin * 2,
    borderColor: COLORS.forest,
    borderWidth: 2,
    color: undefined,
  });
  page.drawRectangle({
    x: margin + 10,
    y: margin + 10,
    width: width - (margin + 10) * 2,
    height: height - (margin + 10) * 2,
    borderColor: COLORS.sage,
    borderWidth: 1,
  });

  // Bandeau nom de la clinique
  drawCentered(page, "MASSOKIN", {
    y: height - 90,
    font: serif,
    size: 26,
    color: COLORS.forest,
  });
  drawCentered(page, "Massothérapeute · Kinésiologue · Villeray, Montréal", {
    y: height - 112,
    font: sans,
    size: 10,
    color: COLORS.body,
  });

  // Séparateur
  page.drawLine({
    start: { x: width / 2 - 60, y: height - 130 },
    end: { x: width / 2 + 60, y: height - 130 },
    thickness: 1,
    color: COLORS.sage,
  });

  // Titre
  drawCentered(page, "Certificat cadeau", {
    y: height - 175,
    font: serif,
    size: 34,
    color: COLORS.ink,
  });

  // Produit offert
  drawCentered(page, productLabel, {
    y: height - 210,
    font: sansBold,
    size: 15,
    color: COLORS.forest,
  });

  // "Offert à"
  drawCentered(page, "Offert à", {
    y: height - 260,
    font: sans,
    size: 11,
    color: COLORS.body,
  });
  drawCentered(page, recipientName || "—", {
    y: height - 288,
    font: serif,
    size: 24,
    color: COLORS.ink,
  });

  // "Par"
  drawCentered(page, `de la part de ${buyerName || "—"}`, {
    y: height - 315,
    font: serifItalic,
    size: 14,
    color: COLORS.body,
  });

  // Message personnel (optionnel), sur 2 lignes max avec retour simple
  if (personalMessage && personalMessage.trim()) {
    const maxWidth = width - 220;
    const words = personalMessage.trim().split(/\s+/);
    let lines = [];
    let current = "";
    for (const word of words) {
      const test = current ? current + " " + word : word;
      if (sans.widthOfTextAtSize(test, 11) > maxWidth) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    lines = lines.slice(0, 2); // max 2 lignes

    let msgY = height - 355;
    lines.forEach((line) => {
      drawCentered(page, `"${line}"`, {
        y: msgY,
        font: serifItalic,
        size: 11,
        color: COLORS.body,
      });
      msgY -= 18;
    });
  }

  // Bas de page : code du certificat + validité + contact
  const bottomY = 95;
  page.drawLine({
    start: { x: 90, y: bottomY + 30 },
    end: { x: width - 90, y: bottomY + 30 },
    thickness: 0.5,
    color: COLORS.line,
  });

  page.drawText(`Code du certificat : ${certificateCode}`, {
    x: 90,
    y: bottomY,
    size: 10,
    font: sansBold,
    color: COLORS.ink,
  });

  const validityText = "Valide 12 mois à compter de la date d'achat";
  const validityWidth = sans.widthOfTextAtSize(validityText, 9);
  page.drawText(validityText, {
    x: width - 90 - validityWidth,
    y: bottomY,
    size: 9,
    font: sans,
    color: COLORS.body,
  });

  drawCentered(page, "Pour réserver : 438 877-5135  ·  www.massokin.com", {
    y: bottomY - 20,
    font: sans,
    size: 9,
    color: COLORS.body,
  });

  return pdfDoc.save();
}

/**
 * Génère un code de certificat lisible, ex: MK-7F3K-9QRT
 */
function generateCertificateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O/1/I pour lisibilité
  const part = (len) =>
    Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `MK-${part(4)}-${part(4)}`;
}

module.exports = { generateGiftCertificate, generateCertificateCode, formatDateFr };
