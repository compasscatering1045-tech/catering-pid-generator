// /api/generate-8460.js  (Vercel Serverless Function - CommonJS w/ CORS)
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const INCH = 72;
const PAGE_W = 8.5 * INCH, PAGE_H = 11 * INCH;

// Avery 8460: 1" x 2-5/8", 3 across x 10 down (30 per sheet)
const LABEL_W = 2.625 * INCH;
const LABEL_H = 1.0 * INCH;
const COLS = 3, ROWS = 10;

// 8460 typical layout (standard Avery geometry)
const MARGIN_L = 0.1875 * INCH;
const MARGIN_R = 0.1875 * INCH;
const MARGIN_T = 0.5 * INCH;
const MARGIN_B = 0.5 * INCH;

const COL_GAP = 0.125 * INCH;
const ROW_GAP = 0.0 * INCH;

const INNER_PAD = 0.08 * INCH;
const TEXT_COLOR = rgb(0, 0, 0);

// Bigger starting size, auto-shrink if needed
const FONT_SIZE = 17;
const MIN_FONT_SIZE = 9;

// Fixed QR size (do not shrink)
const QR_SIZE_INCH = 0.80;
const QR_SIZE = QR_SIZE_INCH * INCH;

// Increase this to make the text area narrower (encourages 3-line wrap)
const GAP_TEXT_QR = 0.14 * INCH;

// Allow up to 3 lines
const MAX_LINES = 3;

// Slightly tighter line-height helps fit 3 lines in a 1" label
const LINE_HEIGHT_MULT = 1.12;

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function indexToGrid(i) {
  const perPage = ROWS * COLS;
  return {
    pageIndex: Math.floor(i / perPage),
    row: Math.floor((i % perPage) / COLS),
    col: (i % perPage) % COLS
  };
}

function labelTopLeft(row, col) {
  const x = MARGIN_L + col * (LABEL_W + COL_GAP);
  const yTop = PAGE_H - MARGIN_T - row * (LABEL_H + ROW_GAP);
  return { x, yBottom: yTop - LABEL_H };
}

function wrapText(text, maxWidth, font, fontSize) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  for (const w of words) {
    const test = line ? line + ' ' + w : w;

    if (font.widthOfTextAtSize(test, fontSize) <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);

      if (font.widthOfTextAtSize(w, fontSize) > maxWidth) {
        // If a single word is too wide, hard-break it
        let acc = '';
        for (const ch of w) {
          if (font.widthOfTextAtSize(acc + ch, fontSize) <= maxWidth) acc += ch;
          else { lines.push(acc); acc = ch; }
        }
        line = acc;
      } else {
        line = w;
      }
    }
  }

  if (line) lines.push(line);
  return lines;
}

module.exports = async function handler(req, res) {
  setCORS(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return res.status(200).send('8460 API OK (root /api, CORS-enabled)');
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  try {
    // Read raw body
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const bodyStr = Buffer.concat(chunks).toString('utf8');

    let items = [];
    let images = [];
    try {
      const parsed = JSON.parse(bodyStr || '{}');
      items  = Array.isArray(parsed.items)  ? parsed.items  : [];
      images = Array.isArray(parsed.images) ? parsed.images : [];
    } catch {
      return res.status(400).send('Bad JSON');
    }

    // Normalize to { name, qrDataUrl }
    const clean = items.map((it) => {
      const name = (it.name || '').toString().trim().toUpperCase();
      let qrDataUrl = '';

      // Preferred: compressed payload { items: [{name, qrRef}], images: [dataUrl...] }
      if (typeof it.qrRef === 'number' && images[it.qrRef]) {
        qrDataUrl = (images[it.qrRef] || '').toString();
      } else if (it.qrDataUrl) {
        // Backward-compatible: direct dataUrl per item
        qrDataUrl = (it.qrDataUrl || '').toString();
      }

      return { name, qrDataUrl };
    }).filter(it => it.name || it.qrDataUrl);

    if (!clean.length) return res.status(400).send('No valid rows provided.');

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);

    // Cache embedded images for repeated QR codes
    const imageCache = new Map();

    for (let i = 0; i < clean.length; i++) {
      const { pageIndex, row, col } = indexToGrid(i);
      while (pdf.getPageCount() <= pageIndex) pdf.addPage([PAGE_W, PAGE_H]);
      const page = pdf.getPage(pageIndex);
      const { x, yBottom } = labelTopLeft(row, col);

      // QR (fixed size), TOP aligned like your sample
      const qrSize = Math.min(QR_SIZE, LABEL_H - 2 * INNER_PAD);
      const qrX = x + LABEL_W - INNER_PAD - qrSize;
      const qrY = yBottom + LABEL_H - INNER_PAD - qrSize;

      // Text area left of QR
      const textX = x + INNER_PAD;
      const textW = Math.max(0, (qrX - GAP_TEXT_QR) - textX);
      const textRect = {
        x: textX,
        y: yBottom + INNER_PAD,
        w: textW,
        h: LABEL_H - 2 * INNER_PAD
      };

      const label = clean[i];

      if (label.name && textRect.w > 0 && textRect.h > 0) {
        let fs = FONT_SIZE;
        let lines = wrapText(label.name, textRect.w, font, fs);

        const fitsNLines = (s, lns) =>
          (lns.length <= MAX_LINES) && (lns.length * s * LINE_HEIGHT_MULT <= textRect.h);

        while (!fitsNLines(fs, lines) && fs > MIN_FONT_SIZE) {
          fs -= 0.5;
          lines = wrapText(label.name, textRect.w, font, fs);
        }

        if (lines.length > MAX_LINES) lines = lines.slice(0, MAX_LINES);

        const lh = fs * LINE_HEIGHT_MULT;

        // TOP aligned text block (not vertically centered), left-justified
        let baseY = yBottom + LABEL_H - INNER_PAD - fs;

        for (let k = 0; k < lines.length; k++) {
          const txt = lines[k];
          const tx = textRect.x;     // left justify
          const ty = baseY - k * lh; // down each line
          page.drawText(txt, { x: tx, y: ty, size: fs, font, color: TEXT_COLOR });
        }
      }

      // QR image
      const dataUrl = label.qrDataUrl;
      if (dataUrl && /^data:image\//i.test(dataUrl)) {
        try {
          let cached = imageCache.get(dataUrl);
          if (!cached) {
            const b64 = (dataUrl.split(',')[1] || '');
            const bytes = Buffer.from(b64, 'base64');
            const isPng = /^data:image\/png/i.test(dataUrl);
            const img = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
            cached = { img };
            imageCache.set(dataUrl, cached);
          }
          page.drawImage(cached.img, { x: qrX, y: qrY, width: qrSize, height: qrSize });
        } catch {
          // ignore bad image and continue
        }
      }
    }

    const pdfBytes = await pdf.save();
    const now = new Date(), pad = n => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const filename = `hot_box_8460_${ts}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    setCORS(res);
    return res.status(200).send(Buffer.from(pdfBytes));
  } catch (e) {
    console.error(e);
    return res.status(500).send('Server error generating PDF.');
  }
};
