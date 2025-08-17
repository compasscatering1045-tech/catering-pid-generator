// api/generate.js
const PDFDocument = require('pdfkit');

/* -------------------- helpers -------------------- */

// Safe background fetch (works on Vercel Node)
async function downloadImage(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${res.status} ${res.statusText}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.error('downloadImage error:', e.message);
    // draw without background if fetch fails
    return Buffer.alloc(0);
  }
}

const toBool = (v, d = false) =>
  typeof v === 'boolean' ? v :
  typeof v === 'string'  ? v.toLowerCase() === 'true' : d;

const toArray = (v) => {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  if (typeof v === 'string') {
    // try JSON first, then comma-split fallback
    try { const j = JSON.parse(v); if (Array.isArray(j)) return j; } catch {}
    return v.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
};

/* -------------------- handler -------------------- */

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Body (coerce if runtime didn’t parse)
    let body = req.body;
    if (!body) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf8');
      try { body = JSON.parse(raw); } catch { body = {}; }
    }
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch {} }

    let { orderData, lineItems, exclude, expandQty, lowercase } = body || {};
    if (!orderData) return res.status(400).json({ error: 'Missing orderData in request body' });

    lineItems = toArray(lineItems);
    exclude   = toArray(exclude);
    // Your preference: one PID per item by default
    expandQty = toBool(expandQty, false);
    lowercase = toBool(lowercase, true);

    const EXCLUDE = exclude.map(s => String(s).toLowerCase().trim());

    // Background image (safe if it fails)
    const backgroundUrl = 'https://raw.githubusercontent.com/compasscatering1045-tech/catering-pid-generator/main/background.png';
    const backgroundImage = await downloadImage(backgroundUrl);

    // ---------- filtering & cleaning ----------
    const shouldExclude = (s) => {
      const t = String(s).toLowerCase().trim();
      if (!t) return true;
      // obvious non-items
      if (/\(\s*x\s*\d+\s*\)\s*$/.test(t)) return true;   // trailing "(x 12)"
      if (/^\d+\s*(?:x|×)?\s*$/.test(t)) return true;      // bare counts like "12 x"
      if (/^(a\s+la\s+carte|beverages?|desserts?)\b/.test(t)) return true;
      return EXCLUDE.some(k => t.includes(k));
    };

    const stripQty = (s) =>
      String(s)
        .replace(/\(\s*x\s*\d+\s*\)\s*$/i, '')   // remove trailing "(x 12)"
        .replace(/^\s*\d+\s*(?:x|×)?\s*/i, '')   // remove leading "12 x " / "12 "
        .trim();

    // ---------- build labels ----------
    let labels = [];

    if (lineItems.length) {
      for (const li of lineItems) {
        const name = stripQty(li?.item || '');
        if (!name || shouldExclude(name)) continue;

        const qty = Number(li?.qty) || 0;
        if (expandQty && qty > 1) {
          for (let i = 0; i < qty; i++) labels.push(name);
        } else {
          labels.push(name); // default: one PID per item
        }
      }
    } else {
      const raw = String(orderData.menuItems || '');
      const rows = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      for (let s of rows) {
        const name = stripQty(s);
        if (!name || shouldExclude(name)) continue;
        labels.push(name);
      }
    }

    if (!labels.length) labels = ['menu item'];
    if (lowercase) labels = labels.map(s => s.toLocaleLowerCase());

    // ---------- PDF setup ----------
    const doc = new PDFDocument({ size: 'LETTER', margin: 36 });

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => {
      const pdf = Buffer.concat(chunks);
      const fname = `pid-${orderData.orderNumber || 'order'}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
      res.status(200).send(pdf);
    });

    // Geometry (LETTER) — 2 cols x 3 rows per page
    const leftRightMargin = 72, topBottomMargin = 36;
    const pidWidth = 216, pidHeight = 216; // 3" x 3"
    const gap = 36;
    const textPaddingTop = 18, textPaddingLR = 18;

    const drawLabel = (x, y, text) => {
      doc.save();
      doc.rect(x, y, pidWidth, pidHeight).clip();
      try { doc.image(backgroundImage, x, y, { width: pidWidth, height: pidHeight }); } catch {}
      doc.restore();

      doc.fillColor('black')
         .font('Helvetica-Bold')
         .fontSize(12)
         .text(text, x + textPaddingLR, y + textPaddingTop, {
            width: pidWidth - (textPaddingLR * 2),
            align: 'center',
            lineBreak: true,
            height: pidHeight - textPaddingTop - 18
         });
    };

    // ---------- auto-pagination ----------
    for (let i = 0; i < labels.length; i++) {
      if (i > 0 && i % 6 === 0) doc.addPage();
      const slot = i % 6;
      const row = Math.floor(slot / 2);
      const col = slot % 2;
      const x = leftRightMargin + col * (pidWidth + gap);
      const y = topBottomMargin + row * (pidHeight + gap);
      drawLabel(x, y, labels[i]);
    }

    doc.end();
  } catch (err) {
    console.error('Error generating PID:', err);
    res.status(500).json({ error: { code: '500', message: 'A server error has occurred' } });
  }
};
