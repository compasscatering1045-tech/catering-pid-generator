// /api/generate-hotbox.js  (root-level Vercel Serverless Function - CommonJS w/ CORS)
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const INCH = 72;
const PAGE_W = 8.5 * INCH, PAGE_H = 11 * INCH;
const LABEL_W = 1.75 * INCH, LABEL_H = (2/3) * INCH;
const COLS = 4, ROWS = 15;
const MARGIN_L = 0.3075 * INCH, MARGIN_R = 0.3075 * INCH, MARGIN_T = 0.505 * INCH, MARGIN_B = 0.505 * INCH;
const USABLE_W = PAGE_W - MARGIN_L - MARGIN_R;
const COL_GAP = (USABLE_W - (COLS * LABEL_W)) / (COLS - 1);
const USABLE_H = PAGE_H - MARGIN_T - MARGIN_B;
const ROW_GAP = (USABLE_H - (ROWS * LABEL_H)) / (ROWS - 1);
const INNER_PAD = 0.05 * INCH, TEXT_COLOR = rgb(0, 0, 0);
const FONT_SIZE = 9, MIN_FONT_SIZE = 7;

function setCORS(res) {
  // If you want to lock this down: replace * with "https://catering-pid-generator.vercel.app"
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

  if (req.method === 'OPTIONS') {
    // Preflight success
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    return res.status(200).send('Hotbox API OK (root /api, CORS-enabled)');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  try {
    // Read raw JSON body (root Vercel function)
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const bodyStr = Buffer.concat(chunks).toString('utf8');

    let items = [];
    try {
      const parsed = JSON.parse(bodyStr || '{}');
      items = Array.isArray(parsed.items) ? parsed.items : [];
    } catch {
      return res.status(400).send('Bad JSON');
    }

    const clean = items.map(it => ({
      name: (it.name || '').toString().trim().toUpperCase(),
      qrDataUrl: (it.qrDataUrl || '').toString()
    })).filter(it => it.name || it.qrDataUrl);

    if (!clean.length) {
      return res.status(400).send('No valid rows provided.');
    }

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);

    for (let i = 0; i < clean.length; i++) {
      const { pageIndex, row, col } = indexToGrid(i);
      while (pdf.getPageCount() <= pageIndex) pdf.addPage([PAGE_W, PAGE_H]);
      const page = pdf.getPage(pageIndex);
      const { x, yBottom } = labelTopLeft(row, col);

      // QR size: request 1.75", constrained by label height
      const qrSize = Math.min(1.75 * INCH, LABEL_H - 2 * INNER_PAD);
      const qrX = x + LABEL_W - INNER_PAD - qrSize;
      const qrY = yBottom + (LABEL_H - qrSize) / 2;

      // Text rect = left area
      const textX = x + INNER_PAD;
      const textW = Math.max(0, (qrX - INNER_PAD) - textX);
      const textRect = { x: textX, y: yBottom + INNER_PAD, w: textW, h: LABEL_H - 2 * INNER_PAD };

      if (clean[i].name && textRect.w > 0 && textRect.h > 0) {
        let fs = FONT_SIZE;
        let lines = wrapText(clean[i].name, textRect.w, font, fs);
        const fits = (s, lns) => (lns.length * s * 1.15) <= textRect.h;
        while (!fits(fs, lines) && fs > MIN_FONT_SIZE) {
          fs -= 0.5;
          lines = wrapText(clean[i].name, textRect.w, font, fs);
        }
        const lh = fs * 1.15;
        const blockH = lines.length * lh;
        let base = textRect.y + (textRect.h - blockH) / 2 + (lines.length - 1) * lh;
        for (let k = 0; k < lines.length; k++) {
          const txt = lines[k];
          const w = font.widthOfTextAtSize(txt, fs);
          const tx = textRect.x + (textRect.w - w) / 2;
          const ty = base - k * lh;
          page.drawText(txt, { x: tx, y: ty, size: fs, font, color: TEXT_COLOR });
        }
      }

      const dataUrl = clean[i].qrDataUrl;
      if (dataUrl && /^data:image\//i.test(dataUrl)) {
        try {
          const b64 = (dataUrl.split(',')[1] || '');
          const bytes = Buffer.from(b64, 'base64');
          const isPng = /^data:image\/png/i.test(dataUrl);
          const img = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
          page.drawImage(img, { x: qrX, y: qrY, width: qrSize, height: qrSize });
        } catch {
          // ignore bad image and continue
        }
      }
    }

    const pdfBytes = await pdf.save();
    const now = new Date(), pad = n => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const filename = `hot_box_${ts}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // CORS on binary response too
    setCORS(res);

    return res.status(200).send(Buffer.from(pdfBytes));
  } catch (e) {
    console.error(e);
    return res.status(500).send('Server error generating PDF.');
  }
};
