// /api/generate-hotbox.js
// Next.js / Vercel serverless function
// npm i pdf-lib

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const INCH = 72;
// US Letter
const PAGE_W = 8.5 * INCH;   // 612
const PAGE_H = 11  * INCH;   // 792

// Avery 88695 / 5195 specs (confirmed)
const LABEL_W_IN  = 1.75;     // 1-3/4"
const LABEL_H_IN  = 2/3;      // ~0.666"
const LABEL_W = LABEL_W_IN * INCH;
const LABEL_H = LABEL_H_IN * INCH;

// Grid: 4 columns x 15 rows = 60 per page
const COLS = 4;
const ROWS = 15;

// Margins (from compatible 5195 sheet spec)
const MARGIN_L_IN = 0.3075;
const MARGIN_R_IN = 0.3075;
const MARGIN_T_IN = 0.505;
const MARGIN_B_IN = 0.505;

const MARGIN_L = MARGIN_L_IN * INCH;
const MARGIN_R = MARGIN_R_IN * INCH;
const MARGIN_T = MARGIN_T_IN * INCH;
const MARGIN_B = MARGIN_B_IN * INCH;

// Compute gaps (horizontal pitch minus label width). Rows pitch ~= label height (gap ~ 0)
const USABLE_W = PAGE_W - MARGIN_L - MARGIN_R;
const H_GAPS = COLS - 1;
const COL_GAP = (USABLE_W - (COLS * LABEL_W)) / H_GAPS;  // ≈ 0.295" gap

// Row gap ~0; distribute tiny rounding if any
const USABLE_H = PAGE_H - MARGIN_T - MARGIN_B;
const V_GAPS = ROWS - 1;
const ROW_GAP = (USABLE_H - (ROWS * LABEL_H)) / V_GAPS; // typically ~0

// Layout inside each label:
// Right side = QR square (target 1.75", constrained to label height minus padding)
// Left side  = text box with small left/right padding
const INNER_PAD_IN = 0.05;                // small padding each side inside text box
const INNER_PAD = INNER_PAD_IN * INCH;
const TEXT_COLOR = rgb(0, 0, 0);

// Font settings
const FONT_SIZE = 9; // will auto-reduce per line if needed
const MIN_FONT_SIZE = 7;

function indexToGrid(i) {
  const pageIndex = Math.floor(i / (ROWS * COLS));
  const indexOnPage = i % (ROWS * COLS);
  const row = Math.floor(indexOnPage / COLS);
  const col = indexOnPage % COLS;
  return { pageIndex, row, col };
}

function labelTopLeft(row, col) {
  const x = MARGIN_L + col * (LABEL_W + COL_GAP);
  const yTop = PAGE_H - MARGIN_T - row * (LABEL_H + ROW_GAP);
  // yTop is the top edge; PDF-lib uses bottom-left origin, so y for drawing baseline needs bottom
  const yBottom = yTop - LABEL_H;
  return { x, yTop, yBottom };
}

// Wrap text to fit width, return lines (ALL CAPS enforced on input)
function wrapText(ctx, text, maxWidth, font, fontSize) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(test, fontSize) <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      // If a single word longer than maxWidth, hard-break it
      if (font.widthOfTextAtSize(w, fontSize) > maxWidth) {
        let acc = '';
        for (const ch of w) {
          if (font.widthOfTextAtSize(acc + ch, fontSize) <= maxWidth) {
            acc += ch;
          } else {
            lines.push(acc);
            acc = ch;
          }
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

// Center lines vertically & horizontally within a rect
function drawCenteredMultiline(page, lines, font, fontSize, rect) {
  const lineHeight = fontSize * 1.15; // slightly tight as requested
  const textBlockH = lines.length * lineHeight;
  let y = rect.y + (rect.h - textBlockH) / 2 + (lines.length - 1) * 0; // top of first baseline calc below

  for (let i = 0; i < lines.length; i++) {
    const txt = lines[i];
    const w = font.widthOfTextAtSize(txt, fontSize);
    const x = rect.x + (rect.w - w) / 2;
    // Baseline position: PDF-lib uses y from bottom; drawText y is baseline
    const baseline = y + (lines.length - 1 - i) * lineHeight + fontSize; // invert because we computed from bottom
    page.drawText(txt, { x, y: baseline - fontSize, size: fontSize, font, color: TEXT_COLOR });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  try {
    const { items } = req.body || {};
    if (!Array.isArray(items)) {
      res.status(400).send('Invalid payload: "items" must be an array.');
      return;
    }

    // Filter empties; enforce ALL CAPS once here
    const clean = items
      .map(it => ({
        name: (it.name || '').toString().trim().toUpperCase(),
        qrDataUrl: (it.qrDataUrl || '').toString()
      }))
      .filter(it => it.name || it.qrDataUrl);

    if (!clean.length) {
      res.status(400).send('No valid rows provided.');
      return;
    }

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);

    // Chunk into pages of 60
    for (let i = 0; i < clean.length; i++) {
      const { pageIndex, row, col } = indexToGrid(i);
      // ensure page exists
      while (pdf.getPageCount() <= pageIndex) {
        pdf.addPage([PAGE_W, PAGE_H]);
      }
      const page = pdf.getPage(pageIndex);
      const { x, yBottom } = labelTopLeft(row, col);

      // Compute inner regions
      // Right: QR square
      const labelRect = { x, y: yBottom, w: LABEL_W, h: LABEL_H };

      // QR target size: requested 1.75" but constrained by label height minus padding
      const maxQr = Math.min(1.75 * INCH, LABEL_H - (2 * INNER_PAD));
      const qrSize = Math.max(0, maxQr);

      // Place QR on the right, vertically centered
      const qrX = labelRect.x + labelRect.w - INNER_PAD - qrSize;
      const qrY = labelRect.y + (labelRect.h - qrSize) / 2;

      // Text area = left remainder with small padding
      const textX = labelRect.x + INNER_PAD;
      const textW = (qrX - INNER_PAD) - textX; // space up to QR left edge
      const textRect = {
        x: textX,
        y: labelRect.y + INNER_PAD,
        w: Math.max(0, textW),
        h: labelRect.h - 2 * INNER_PAD
      };

      // Draw text (if any), shrink font minimally to fit lines within height if necessary
      if (clean[i].name && textRect.w > 0 && textRect.h > 0) {
        let size = FONT_SIZE;
        let lines = wrapText(null, clean[i].name, textRect.w, font, size);

        // If text too tall, reduce size down to MIN_FONT_SIZE
        const fits = (fs, lns) => (lns.length * fs * 1.15) <= textRect.h;
        while (!fits(size, lines) && size > MIN_FONT_SIZE) {
          size -= 0.5;
          lines = wrapText(null, clean[i].name, textRect.w, font, size);
        }
        drawCenteredMultiline(page, lines, font, size, textRect);
      }

      // Draw QR image if provided
      if (clean[i].qrDataUrl) {
        try {
          const dataUrl = clean[i].qrDataUrl;
          const isPng = dataUrl.startsWith('data:image/png');
          const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
          const img = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
          page.drawImage(img, { x: qrX, y: qrY, width: qrSize, height: qrSize });
        } catch (e) {
          // skip bad image; keep rendering
        }
      }
    }

    const pdfBytes = await pdf.save();

    // filename
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const filename = `hot_box_${ts}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error generating PDF.');
  }
}
