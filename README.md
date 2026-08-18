# Massokin — Backend Stripe

Petit serveur Express qui crée des sessions Stripe Checkout pour
`forfaits.html` (forfaits et cartes-cadeaux).

## 1. Installation locale

```bash
npm install
cp .env.example .env
```

Remplis `.env` avec :
- `STRIPE_SECRET_KEY` — Dashboard Stripe → Developers → API keys → clé **secrète** (`sk_test_...` pour tester)
- `STRIPE_WEBHOOK_SECRET` — voir étape 4 plus bas
- `SITE_URL` — l'URL de ton site (ex: `https://www.massokin.com`)

Lance le serveur :

```bash
npm run dev
```

Le serveur tourne sur `http://localhost:3000`.

## 2. Tester en local avec ton HTML

Dans `forfaits.html`, mets temporairement :

```js
window.__BACKEND_URL__ = "http://localhost:3000";
```

Ouvre `forfaits.html` dans ton navigateur (ex: avec l'extension VS Code
"Live Server") et clique "Acheter maintenant". Utilise une carte de test
Stripe : `4242 4242 4242 4242`, n'importe quelle date future, n'importe quel CVC.

## 3. Déployer le backend (Render — gratuit pour commencer)

1. Pousse ce dossier sur un repo GitHub
2. Va sur [render.com](https://render.com) → New → Web Service → connecte ton repo
3. Build command : `npm install`
4. Start command : `npm start`
5. Ajoute les variables d'environnement (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL`) dans l'onglet "Environment"
6. Une fois déployé, tu obtiens une URL du type `https://massokin-backend.onrender.com`

Alternatives équivalentes : [Railway](https://railway.app), [Fly.io](https://fly.io).

## 4. Configurer le webhook Stripe

Le webhook confirme le paiement côté serveur (indispensable — ne fais
jamais confiance à `success_url` seul, un client pourrait y accéder sans payer).

1. Dashboard Stripe → Developers → Webhooks → "Add endpoint"
2. URL : `https://ton-backend.onrender.com/api/stripe-webhook`
3. Événement à écouter : `checkout.session.completed`
4. Stripe te donne un "Signing secret" (`whsec_...`) → mets-le dans `STRIPE_WEBHOOK_SECRET`

Pour tester en local, utilise le [Stripe CLI](https://stripe.com/docs/stripe-cli) :

```bash
stripe listen --forward-to localhost:3000/api/stripe-webhook
```

## 5. Brancher ton frontend

Dans `forfaits.html`, remplace par l'URL réelle de ton backend déployé :

```js
window.__BACKEND_URL__ = "https://ton-backend.onrender.com";
```

## 7. Sécurité — à ne jamais faire

C'est déjà branché ✅ — dès que le webhook reçoit `checkout.session.completed` :

1. `certificate.js` génère un certificat-cadeau PDF (format paysage, mise en page
   assortie au site : forêt/crème/sauge, cadre décoratif, code unique du type `MK-7F3K-9QRT`)
2. `email.js` envoie les courriels via [Resend](https://resend.com) :
   - **Si c'est un cadeau** : le PDF part au **destinataire**, et l'acheteur reçoit une
     confirmation simple (sans PDF, puisqu'il l'a déjà envoyé).
   - **Si c'est un achat pour soi-même** (forfait) : le PDF part directement à l'**acheteur**.

### Configurer Resend

1. Crée un compte sur [resend.com](https://resend.com) (généreux plan gratuit)
2. Ajoute et vérifie ton domaine (`massokin.com`) dans Dashboard → Domains
   — Resend te donnera des enregistrements DNS (TXT/CNAME) à ajouter chez ton
   registraire de domaine. Sans domaine vérifié, tu ne peux envoyer que vers
   ta propre adresse de test.
3. Dashboard → API Keys → crée une clé → mets-la dans `RESEND_API_KEY`
4. Choisis l'adresse d'expédition, ex. `cadeaux@massokin.com`, et mets-la
   dans `EMAIL_FROM` (doit appartenir au domaine vérifié)

### Tester la génération du PDF sans passer par Stripe

```bash
node -e '
const { generateGiftCertificate, generateCertificateCode } = require("./certificate");
(async () => {
  const pdfBytes = await generateGiftCertificate({
    productLabel: "Certificat cadeau — Détente 90 min",
    recipientName: "Marie Tremblay",
    buyerName: "Jean Dupuis",
    personalMessage: "Joyeux anniversaire !",
    certificateCode: generateCertificateCode(),
  });
  require("fs").writeFileSync("test.pdf", pdfBytes);
  console.log("PDF généré : test.pdf");
})();
'
```

## 7. Base de données des certificats — vérifier/valider en clinique

Chaque vente confirmée est maintenant sauvegardée dans une base **SQLite**
locale (fichier unique, aucun serveur externe à gérer) via `db.js`. Ça te
permet de vérifier qu'un certificat est légitime et de le marquer "utilisé"
pour éviter qu'il resserve.

### Vérifier un certificat (sans le consommer)

```bash
curl -H "x-admin-key: TA_CLE_ADMIN" \
  https://ton-backend.onrender.com/api/certificates/MK-7F3K-9QRT
```

Retourne les infos du certificat, avec `redeemedAt: null` s'il n'a pas
encore été utilisé.

### Marquer un certificat comme utilisé (après le rendez-vous)

```bash
curl -X POST -H "x-admin-key: TA_CLE_ADMIN" -H "Content-Type: application/json" \
  -d '{"note":"Rendez-vous du 20 août"}' \
  https://ton-backend.onrender.com/api/certificates/MK-7F3K-9QRT/redeem
```

Renvoie une erreur `409` si le certificat a déjà été utilisé — impossible
de le valider deux fois.

### Configurer la clé admin

Dans `.env`, définis `ADMIN_KEY` avec une chaîne longue et aléatoire
(ex: `openssl rand -hex 32`). Sans cette clé dans l'en-tête `x-admin-key`,
ces deux routes renvoient `401 Non autorisé`.

**Idée pratique** : tu peux enregistrer ces deux appels comme raccourcis
dans une app comme Postman ou Insomnia sur ton téléphone, pour vérifier un
certificat en 2 secondes quand un client arrive en clinique.

### ⚠️ Important — persistance du disque en production

Sur **Render** (plan gratuit) et la plupart des hébergeurs "serverless",
le système de fichiers est **éphémère** : si le serveur redémarre ou se
redéploie, le fichier `data/massokin.db` (et donc tout l'historique des
certificats) peut être **perdu**.

Deux solutions :
- **Render** : ajoute un ["Persistent Disk"](https://render.com/docs/disks)
  à ton service (quelques dollars/mois) et pointe `DB_PATH` vers ce disque.
- **Alternative plus robuste** : migrer vers une base hébergée gérée
  (ex: [Turso](https://turso.tech) qui est compatible SQLite, ou Postgres
  via [Neon](https://neon.tech) / [Supabase](https://supabase.com), plans
  gratuits disponibles). Dis-moi si tu veux que je fasse la migration —
  c'est un changement limité à `db.js`, le reste du code ne bouge pas.

### Ce qu'il reste comme amélioration possible (optionnel)

- **Retry en cas d'échec d'envoi** : si Resend échoue, l'erreur est
  seulement logguée (`console.error`). Pour une vraie prod, brancher un
  outil de monitoring (Sentry) ou une file d'attente avec retry serait plus robuste.
- **Personnaliser davantage le certificat** : logo, couleurs, format — tout
  se trouve dans `certificate.js`, chaque élément est positionné en coordonnées
  (x, y) avec `pdf-lib`.
- **Petit tableau de bord admin** : une page web simple listant les ventes
  récentes (`listRecentCertificates` existe déjà dans `db.js`, il ne manque
  qu'une route + une page HTML pour l'afficher).

## 8. Sécurité — à ne jamais faire

- Ne jamais mettre `STRIPE_SECRET_KEY` dans le code frontend (HTML/JS visible par le client)
- Ne jamais committer `.env` sur GitHub
- Toujours vérifier la signature du webhook (déjà fait dans `server.js`)
- Garder `ADMIN_KEY` secrète — quiconque la possède peut lire et valider des certificats
