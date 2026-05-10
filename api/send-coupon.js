function escapeHtml(text) {
  const s = String(text);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Adresses destinataires BCC depuis OWNER_EMAIL ("a@x.fr, b@y.fr"). */
function parseOwnerEmails(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  /** Expéditeur vérifié sur Resend (obligatoire en prod). Défaut : adresse de test Resend. */
  const from =
    process.env.RESEND_FROM || 'Roulette Restaurant <onboarding@resend.dev>';

  if (!apiKey) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Configuration serveur : ajoutez RESEND_API_KEY sur Vercel.' }));
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Requête invalide' }));
      return;
    }
  }
  if (!body || typeof body !== 'object') {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Requête invalide' }));
    return;
  }

  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const prize =
    typeof body.prize === 'string' ? body.prize.trim().slice(0, 200) : '';
  const couponCode =
    typeof body.couponCode === 'string'
      ? body.couponCode.trim().slice(0, 32)
      : '';

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailOk || !prize || !couponCode) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Email, lot ou code coupon invalide.' }));
    return;
  }

  const prizeHtml = escapeHtml(prize);
  const codeHtml = escapeHtml(couponCode);
  const html = `<!DOCTYPE html>
<html><body>
  <p>Bonjour,</p>
  <p>Merci d’avoir participé à la roue de la chance.</p>
  <p>Vous avez gagné : <strong>${prizeHtml}</strong></p>
  <p>Votre code coupon : <strong>${codeHtml}</strong></p>
  <p>À présenter au restaurant.</p>
</body></html>`;

  const bccList = parseOwnerEmails(process.env.OWNER_EMAIL).filter((a) => a !== email);

  try {
    const payload = {
      from,
      to: [email],
      subject: `Votre coupon restaurant : ${couponCode}`,
      html,
    };
    if (bccList.length) payload.bcc = bccList;

    const outgoing = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await outgoing.json();

    if (!outgoing.ok) {
      console.error('[send-coupon] Resend', outgoing.status, data);
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error:
            typeof data.message === 'string'
              ? data.message
              : 'L’envoi du mail a échoué. Vérifiez votre domaine expéditeur sur Resend.',
        })
      );
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, id: data.id }));
  } catch (err) {
    console.error('[send-coupon]', err);
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Erreur réseau lors de l’envoi.' }));
  }
};
