require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const { generateGiftCertificate, generateCertificateCode } = require("./certificate");
const { sendGiftEmailToRecipient, sendPurchaseConfirmation } = require("./email");
const { saveCertificate, getCertificateByCode, redeemCertificate } = require("./db");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();

const SITE_URL = process.env.SITE_URL || "http://localhost:5500";

// ============================================================
// CATALOGUE DES PRODUITS — doit rester IDENTIQUE aux clés
// utilisées côté frontend (attribut data-checkout sur les boutons)
// ============================================================
const PRODUCTS = {
  "forfait-therapeutique-5x60": {
    label: "Forfait Thérapeutique 60 min × 5",
    amount: 52900, // en cents CAD
  },
  "forfait-therapeutique-5x90": {
    label: "Forfait Thérapeutique 90 min × 5",
    amount: 64400,
  },
  "forfait-therapeutique-10x60": {
    label: "Forfait Thérapeutique 60 min × 10",
    amount: 103500,
  },
  "forfait-therapeutique-10x90": {
    label: "Forfait Thérapeutique 90 min × 10",
    amount: 126000,
  },
  "carte-detente-60": {
    label: "Certificat cadeau — Détente 60 min",
    amount: 11500,
  },
  "carte-detente-90": {
    label: "Certificat cadeau — Détente 90 min",
    amount: 14000,
  },
  "forfait-detente-5x60": {
    label: "Forfait Détente 60 min × 5",
    amount: 52900,
  },
  "forfait-detente-5x90": {
    label: "Forfait Détente 90 min × 5",
    amount: 64400,
  },
  "forfait-detente-10x60": {
    label: "Forfait Détente 60 min × 10",
    amount: 103500,
  },
  "forfait-detente-10x90": {
    label: "Forfait Détente 90 min × 10",
    amount: 126000,
  },
};

// ============================================================
// IMPORTANT : le webhook Stripe a besoin du corps BRUT (raw)
// de la requête pour vérifier la signature. Il doit donc être
// déclaré AVANT app.use(express.json()).
// ============================================================
app.post(
  "/api/stripe-webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Signature webhook invalide :", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Paiement complété avec succès
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const metadata = session.metadata || {};

      console.log("✅ Paiement confirmé :", {
        productKey: metadata.productKey,
        buyerEmail: metadata.buyerEmail,
        isGift: metadata.isGift,
      });

      // On répond tout de suite à Stripe (il attend un 200 rapide),
      // puis on traite l'envoi du certificat en arrière-plan.
      handlePaidOrder(metadata, session.id).catch((err) => {
        console.error("❌ Erreur lors du traitement post-paiement :", err);
        // TODO idéalement : logguer dans un système de monitoring
        // (Sentry, etc.) pour pouvoir renvoyer le certificat manuellement.
      });
    }

    res.json({ received: true });
  }
);

/**
 * Génère le certificat PDF et envoie les emails appropriés,
 * une fois le paiement confirmé par Stripe.
 */
async function handlePaidOrder(metadata, stripeSessionId) {
  const {
    productKey,
    buyerName,
    buyerEmail,
    isGift,
    recipientName,
    recipientEmail,
    personalMessage,
  } = metadata;

  const product = PRODUCTS[productKey];
  if (!product) {
    console.error(`Produit inconnu dans metadata: ${productKey}`);
    return;
  }

  const gift = isGift === "true";
  const certificateCode = generateCertificateCode();

  const pdfBytes = await generateGiftCertificate({
    productLabel: product.label,
    recipientName: gift ? recipientName : buyerName,
    buyerName,
    personalMessage: gift ? personalMessage : "",
    certificateCode,
  });

  // Sauvegarde en base AVANT l'envoi des emails : si l'email échoue,
  // on garde quand même une trace de la vente et du code généré.
  saveCertificate({
    certificateCode,
    stripeSessionId,
    productKey,
    productLabel: product.label,
    amountCents: product.amount,
    isGift: gift,
    buyerName,
    buyerEmail,
    recipientName: gift ? recipientName : null,
    recipientEmail: gift ? recipientEmail : null,
    personalMessage: gift ? personalMessage : null,
  });

  if (gift) {
    // Cadeau : le PDF part au destinataire, l'acheteur reçoit une confirmation simple
    await sendGiftEmailToRecipient({
      recipientEmail,
      recipientName,
      buyerName,
      productLabel: product.label,
      personalMessage,
      pdfBytes,
    });

    await sendPurchaseConfirmation({
      buyerEmail,
      buyerName,
      productLabel: product.label,
      isGift: true,
      recipientName,
    });

    console.log(`📧 Certificat envoyé à ${recipientEmail} (cadeau de ${buyerEmail})`);
  } else {
    // Achat pour soi-même : le PDF part directement à l'acheteur
    await sendPurchaseConfirmation({
      buyerEmail,
      buyerName,
      productLabel: product.label,
      isGift: false,
      pdfBytes,
    });

    console.log(`📧 Certificat envoyé à ${buyerEmail} (achat personnel)`);
  }

  console.log(`📧 Certificat ${certificateCode} enregistré et envoyé.`);
}

// Pour toutes les autres routes, on peut parser le JSON normalement
app.use(cors());
app.use(express.json());

// ============================================================
// ROUTE : création de la session de paiement Stripe
// ============================================================
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const {
      productKey,
      buyerName,
      buyerEmail,
      isGift,
      recipientName,
      recipientEmail,
      deliveryDate,
      personalMessage,
    } = req.body;

    const product = PRODUCTS[productKey];
    if (!product) {
      return res.status(400).json({ detail: "Produit invalide." });
    }

    if (!buyerName || !buyerEmail) {
      return res
        .status(400)
        .json({ detail: "Nom et courriel de l'acheteur requis." });
    }

    if (isGift && (!recipientName || !recipientEmail)) {
      return res
        .status(400)
        .json({ detail: "Nom et courriel du destinataire requis pour un cadeau." });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: buyerEmail,
      line_items: [
        {
          price_data: {
            currency: "cad",
            product_data: {
              name: product.label,
            },
            unit_amount: product.amount,
          },
          quantity: 1,
        },
      ],
      // Ces infos ressortiront dans le webhook (session.metadata)
      metadata: {
        productKey,
        buyerName,
        buyerEmail,
        isGift: isGift ? "true" : "false",
        recipientName: recipientName || "",
        recipientEmail: recipientEmail || "",
        deliveryDate: deliveryDate || "",
        personalMessage: (personalMessage || "").slice(0, 300),
      },
      success_url: `${process.env.SITE_URL}/forfaits.html?success=true`,
      cancel_url: `${SITE_URL}/forfaits.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Erreur création session Stripe :", err);
    res.status(500).json({ detail: "Erreur serveur lors de la création du paiement." });
  }
});

// Route de santé, utile pour vérifier que le serveur tourne
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// ============================================================
// ROUTES ADMIN — vérifier / valider un certificat en clinique
// Protégées par une clé simple envoyée dans l'en-tête x-admin-key.
// Défini ADMIN_KEY dans .env avec une valeur longue et aléatoire.
// ============================================================
function requireAdminKey(req, res, next) {
  const key = req.headers["x-admin-key"];
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ detail: "Non autorisé." });
  }
  next();
}

// Vérifie un certificat par son code, SANS le marquer comme utilisé.
// GET /api/certificates/:code
app.get("/api/certificates/:code", requireAdminKey, (req, res) => {
  const cert = getCertificateByCode(req.params.code);
  if (!cert) {
    return res.status(404).json({ detail: "Aucun certificat avec ce code." });
  }
  res.json({
    code: cert.certificate_code,
    productLabel: cert.product_label,
    buyerName: cert.buyer_name,
    buyerEmail: cert.buyer_email,
    recipientName: cert.recipient_name,
    isGift: !!cert.is_gift,
    createdAt: cert.created_at,
    redeemedAt: cert.redeemed_at, // null = pas encore utilisé
    redeemedNote: cert.redeemed_note,
  });
});

// Marque un certificat comme utilisé (à appeler une fois le rendez-vous
// honoré, pour empêcher qu'il soit réutilisé).
// POST /api/certificates/:code/redeem  Body: { "note": "optionnel" }
app.post("/api/certificates/:code/redeem", requireAdminKey, (req, res) => {
  const cert = getCertificateByCode(req.params.code);
  if (!cert) {
    return res.status(404).json({ detail: "Aucun certificat avec ce code." });
  }
  if (cert.redeemed_at) {
    return res.status(409).json({
      detail: "Ce certificat a déjà été utilisé.",
      redeemedAt: cert.redeemed_at,
    });
  }
  const ok = redeemCertificate(req.params.code, req.body?.note);
  res.json({ success: ok });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur Massokin backend démarré sur le port ${PORT}`);
});
