// /api/generate-22816.js  (Vercel Serverless Function - CommonJS w/ CORS)
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const INCH = 72;
const PAGE_W = 8.5 * INCH;
const PAGE_H = 11 * INCH;

// Avery 22816: 2" x 2" squares, 3 across x 4 down (12 per sheet)
const LABEL_W = 2 * INCH;
const LABEL_H = 2 * INCH;
const COLS = 3;
const ROWS = 4;

// Approximate layout: 0.5" side margins, 0.75" horiz gap, 0.5" top/bottom, auto vert gap
const MARGIN_L = 0.5 * INCH;
const MARGIN_R = 0.5 * INCH;
const MARGIN_T = 0.5 * INCH;
const MARGIN_B = 0.5 * INCH;
const USABLE_W = PAGE_W - MARGIN_L - MARGIN_R;
const COL_GAP = (USABLE_W - (COLS * LABEL_W)) / (COLS - 1); // ~0.75"
const USABLE_H = PAGE_H - MARGIN_T - MARGIN_B;
const ROW_GAP = (USABLE_H - (ROWS * LABEL_H)) / (ROWS - 1); // ~0.67"

const INNER_PAD = 0.08 * INCH;
const TEXT_COLOR = rgb(0, 0, 0);
const FONT_SIZE = 9;
const MIN_FONT_SIZE = 7;

// Vertical layout inside each 2"x2" label
const PAD_TOP = 0.15 * INCH;
const PAD_BOTTOM = 0.12 * INCH;
const GAP_TITLE_QR = 0.08 * INCH;
const QR_SIZE_INCH = 1.25;  // constant QR size for all labels
const QR_SIZE = QR_SIZE_INCH * INCH;

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
  if (req.method === 'GET') return res.status(200).send('22816 API OK (root /api, CORS-enabled)');
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
      if (typeof it.qrRef === 'number' && images[it.qrRef]) {
        qrDataUrl = (images[it.qrRef] || '').toString();
      } else if (it.qrDataUrl) {
        qrDataUrl = (it.qrDataUrl || '').toString();
      }
      return { name, qrDataUrl };
    }).filter(it => it.name || it.qrDataUrl);

    if (!clean.length) return res.status(400).send('No valid rows provided.');

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);

    // Cache images so repeated QR codes are only embedded once
    const imageCache = new Map();

    for (let i = 0; i < clean.length; i++) {
      const { pageIndex, row, col } = indexToGrid(i);
      while (pdf.getPageCount() <= pageIndex) pdf.addPage([PAGE_W, PAGE_H]);
      const page = pdf.getPage(pageIndex);
      const { x, yBottom } = labelTopLeft(row, col);

      // Text area at top
      const textAreaHeight = LABEL_H - PAD_TOP - GAP_TITLE_QR - QR_SIZE - PAD_BOTTOM;
      const textRect = {
        x: x + INNER_PAD,
        w: LABEL_W - 2 * INNER_PAD,
        y: yBottom + LABEL_H - PAD_TOP - textAreaHeight,
        h: textAreaHeight
      };

      const label = clean[i];

      if (label.name && textRect.w > 0 && textRect.h > 0) {
        let fs = FONT_SIZE;
        let lines = wrapText(label.name, textRect.w, font, fs);

        // Aim for max 2 lines; shrink font as needed but don't shrink QR
        const fits = (s, lns) => (lns.length <= 2) && (lns.length * s * 1.15 <= textRect.h);

        while (!fits(fs, lines) && fs > MIN_FONT_SIZE) {
          fs -= 0.5;
          lines = wrapText(label.name, textRect.w, font, fs);
        }

        if (lines.length > 2) {
          lines = lines.slice(0, 2);
        }

        const lh = fs * 1.15;
        const blockH = lines.length * lh;
        let baseY = textRect.y + (textRect.h - blockH) / 2 + (lines.length - 1) * lh;

        for (let k = 0; k < lines.length; k++) {
          const txt = lines[k];
          const w = font.widthOfTextAtSize(txt, fs);
          const tx = textRect.x + (textRect.w - w) / 2;
          const ty = baseY - k * lh;
          page.drawText(txt, { x: tx, y: ty, size: fs, font, color: TEXT_COLOR });
        }
      }

      // QR centered below title
      const qrX = x + (LABEL_W - QR_SIZE) / 2;
      const qrY = yBottom + PAD_BOTTOM;

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
          page.drawImage(cached.img, { x: qrX, y: qrY, width: QR_SIZE, height: QR_SIZE });
        } catch {
          // ignore bad image and continue
        }
      }
    }

    const pdfBytes = await pdf.save();
    const now = new Date(), pad = n => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const filename = `hot_box_22816_${ts}.pdf`; // prefix hot_box_ as requested

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    setCORS(res);
    return res.status(200).send(Buffer.from(pdfBytes));
  } catch (e) {
    console.error(e);
    return res.status(500).send('Server error generating PDF.');
  }
};
