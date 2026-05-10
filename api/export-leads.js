async function loadLeadsCsvText() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;

  const filename = process.env.LEADS_CSV_FILENAME || 'roulette-leads.csv';

  try {
    const { list } = await import('@vercel/blob');
    const listing = await list({ prefix: filename, token, limit: 50 });
    const blob =
      listing.blobs.find(function (b) {
        return b.pathname === filename;
      }) ||
      listing.blobs.find(function (b) {
        return b.pathname.endsWith(filename);
      });

    if (!blob || !blob.downloadUrl) {
      return '';
    }

    const r = await fetch(blob.downloadUrl);
    if (!r.ok) return '';
    return await r.text();
  } catch (err) {
    console.error('[export-leads]', err);
    return null;
  }
}

function authorize(req, exportSecret) {
  if (!exportSecret || exportSecret.length < 16) return false;

  const auth = req.headers.authorization;
  const bearer =
    typeof auth === 'string' && auth.slice(0, 7).toLowerCase() === 'bearer '
      ? auth.slice(7).trim()
      : '';

  const headerKey = req.headers['x-export-secret'];
  const headerVal = Array.isArray(headerKey) ? headerKey[0] : headerKey;

  const urlObj = req.url.startsWith('/')
    ? new URL(req.url, 'http://localhost')
    : new URL(req.url || '', 'http://localhost');
  const qp = urlObj.searchParams.get('key');

  const provided = bearer || (typeof headerVal === 'string' ? headerVal.trim() : '') || (qp ? qp.trim() : '');

  return provided === exportSecret;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-Export-Secret, Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const exportSecret = process.env.EXPORT_SECRET;
  if (!authorize(req, exportSecret)) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Non autorisé. Définissez EXPORT_SECRET (min. 16 car.) et passez Bearer ou header X-Export-Secret.' }));
    return;
  }

  const csv = await loadLeadsCsvText();
  if (csv === null) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: 'Stockage Blob non configuré. Ajoutez BLOB_READ_WRITE_TOKEN sur Vercel.',
      })
    );
    return;
  }

  const header = 'timestamp_iso,email,prize,coupon_code\n';
  const body = csv.trim() ? csv.trim() + '\n' : header;

  const name = process.env.LEADS_CSV_FILENAME || 'roulette-leads.csv';
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
};
