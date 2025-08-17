// ... keep your CORS + method handling + image download ...

// Use the built-in fetch in the Vercel Node runtime
async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`downloadImage fetch failed: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

// Coercion helpers
const toBool = (v, d=false) =>
  typeof v === 'boolean' ? v : (typeof v === 'string' ? v.toLowerCase() === 'true' : d);

const toArray = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); if (Array.isArray(p)) return p; } catch {}
    return v.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
};

// Inside your handler:
let { orderData, lineItems, exclude, expandQty, lowercase } = req.body || {};
lineItems  = Array.isArray(lineItems) ? lineItems : toArray(lineItems);
exclude    = toArray(exclude);
expandQty  = toBool(expandQty, true);
lowercase  = toBool(lowercase, true);

// Later:
const EXCLUDE = exclude.map(s => String(s).toLowerCase().trim());

module.exports = async (req, res) => {
  // CORS and method checks (unchanged)

  try {
    const { orderData, lineItems = [], exclude = [], expandQty = true } = req.body || {};
    if (!orderData) return res.status(400).json({ error: 'Missing orderData in request body' });

    // Download background once
    const backgroundUrl = 'https://raw.githubusercontent.com/compasscatering1045-tech/catering-pid-generator/main/background.png';
    const backgroundImage = await downloadImage(backgroundUrl);

    // ---------- Build the label list ----------
    const EXCLUDE = exclude.map(s => String(s).toLowerCase().trim());

    const shouldExclude = (s) => {
      const t = String(s).toLowerCase().trim();
      if (!t) return true;
      // drop obvious group headers / sections
      if (/\b(x\s*\d+)\)?\s*$/i.test(t)) return true;          // trailing (x 12)
      if (/^\d+\s*(?:x|×)?\s*$/i.test(t)) return true;         // bare counts
      if (/^(a\s+la\s+carte|beverages|desserts?)\b/i.test(t)) return true;
      // user-provided excludes
      return EXCLUDE.some(k => t.includes(k));
    };

    const stripQty = (s) => {
      let r = String(s);
      r = r.replace(/\(\s*x\s*\d+\s*\)\s*$/i, '');   // remove trailing (x 12)
      r = r.replace(/^\s*\d+\s*(?:x|×)?\s*/i, '');    // remove leading "12 x" or "12"
      r = r.trim();
      return r;
    };

    let labels = [];

    if (Array.isArray(lineItems) && lineItems.length) {
      // Prefer structured items when provided
      for (const li of lineItems) {
        const name = stripQty(li?.item || '');
        if (!name || shouldExclude(name)) continue;
        labels.push(name);

      }
    } else {
      // Fallback: parse from menuItems string (keep case, split lines)
      const raw = String(orderData.menuItems || '');
      const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      for (let s of lines) {
        const name = stripQty(s);
        if (!name || shouldExclude(name)) continue;
        labels.push(name);
      }
    }

    if (!labels.length) labels = ['menu item'];

    // ---------- PDF setup ----------
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'LETTER', margin: 36 });

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="pid-${orderData.orderNumber}.pdf"`);
      res.status(200).send(pdfBuffer);
    });

    // Geometry
    const pageWidth = 612, pageHeight = 792;
    const leftRightMargin = 72;
    const topBottomMargin = 36;
    const pidWidth = 216, pidHeight = 216; // 3" x 3"
    const gap = 36;
    const textPaddingTop = 18, textPaddingLR = 18;

    // ---------- Draw all labels with auto-pagination (6 per page) ----------
    const drawOne = (x, y, text) => {
      // clip + background
      doc.save();
      doc.rect(x, y, pidWidth, pidHeight).clip();
      try {
        doc.image(backgroundImage, x, y, { width: pidWidth, height: pidHeight });
      } catch {}
      doc.restore();

      // centered text
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

    for (let i = 0; i < labels.length; i++) {
      if (i > 0 && i % 6 === 0) doc.addPage();                     // NEW: extra pages
      const slot = i % 6;
      const row = Math.floor(slot / 2);
      const col = slot % 2;
      const x = leftRightMargin + col * (pidWidth + gap);
      const y = topBottomMargin + row * (pidHeight + gap);
      drawOne(x, y, labels[i]);
    }

    doc.end();
  } catch (error) {
    console.error('Error generating PID:', error);
    res.status(500).json({ error: 'Failed to generate PID', details: error.message });
  }
};



