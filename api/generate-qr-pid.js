// api/generate-qr-pid.js
const PDFDocument = require('pdfkit');

function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') {
      return resolve(req.body);
    }
    if (typeof req.body === 'string') {
      try { return resolve(JSON.parse(req.body)); } catch (e) {}
    }

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolve(JSON.parse(raw)); }
      catch (e) { resolve({}); }
    });
  });
}

// Decode a data URL like "data:image/png;base64,AAAA..."
function decodeDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
  if (!match) return null;
  return Buffer.from(match[2], 'base64');
}

module.exports = async (req, res) => {
  // CORS (similar style to your other APIs)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,OPTIONS,PATCH,DELETE,POST,PUT'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, ' +
      'Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = await parseBody(req);

    let { items, layout } = body || {};
    if (!Array.isArray(items)) items = [];

    // Keep only rows that have BOTH itemName and qrImageDataUrl
    const cleaned = items
      .map((it) => ({
        itemName: (it.itemName || '').toString().trim(),
        qrImageDataUrl: it.qrImageDataUrl || ''
      }))
      .filter((it) => it.itemName && it.qrImageDataUrl);

    if (!cleaned.length) {
      return res.status(400).json({ error: 'No valid items provided' });
    }

    const labels = cleaned; // allow any number of labels

    // Layout hints (with defaults)
    const cfg = layout || {};
    const inch = 72;
    const outerPaddingInches        = Number(cfg.outerPaddingInches ?? 0.25);
    const gapBetweenTextAndQrInches = Number(cfg.gapBetweenTextAndQrInches ?? 0.25);
    const qrSizeInches              = Number(cfg.qrSizeInches ?? 1);

    const qrSize            = qrSizeInches * inch;                // 1" -> 72 pts
    const gapBetweenTextAndQr = gapBetweenTextAndQrInches * inch; // 0.25" -> 18 pts
    const innerPadding      = 0.25 * inch;                        // 1/4" padding inside each label

    // PDF setup
    const doc = new PDFDocument({
      size: 'LETTER',                 // 612 x 792
      margin: outerPaddingInches * inch
    });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => {
      const pdf = Buffer.concat(chunks);
      const safeName = 'pid-qr-6up';
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeName}.pdf"`
      );
      res.status(200).send(pdf);
    });

    // Geometry: Letter + labels (2 cols x 3 rows per page), 3" x 3" each
    const pageWidth  = doc.page.width;   // 612
    const pageHeight = doc.page.height;  // 792

    const pidWidth  = 3 * inch;
    const pidHeight = 3 * inch;
    const gap       = 0.5 * inch;        // 0.5" between labels

    const totalLabelsWidth  = pidWidth * 2 + gap;
    const totalLabelsHeight = pidHeight * 3 + gap * 2;

    const leftRightMargin  = (pageWidth  - totalLabelsWidth)  / 2;
    const topBottomMargin  = (pageHeight - totalLabelsHeight) / 2;

    function drawLabelWithQr(x, y, text, qrBuffer) {
      if (!qrBuffer) return;

      const contentX = x + innerPadding;
      const contentY = y + innerPadding;
      const contentWidth  = pidWidth  - innerPadding * 2;
      const contentHeight = pidHeight - innerPadding * 2;

      // Split horizontal: text (left) + 1/4" gap + 1" QR
      const textWidth = contentWidth - qrSize - gapBetweenTextAndQr;
      const qrX       = contentX + textWidth + gapBetweenTextAndQr;

      const centerY = y + pidHeight / 2;

      doc.font('Helvetica-Bold').fontSize(14);

      const textOptions = {
        width: textWidth,
        align: 'left',
        lineBreak: true
      };

      let textHeight;
      try {
        textHeight = doc.heightOfString(text, textOptions);
      } catch (e) {
        textHeight = 14;
      }
      if (textHeight > contentHeight) textHeight = contentHeight;

      let textTop = centerY - textHeight / 2;
      if (textTop < contentY) textTop = contentY;
      if (textTop + textHeight > contentY + contentHeight) {
        textTop = contentY + contentHeight - textHeight;
      }

      // Draw text (left)
      doc.save();
      doc.rect(contentX, contentY, textWidth, contentHeight).clip();
      doc.fillColor('black').text(text, contentX, textTop, textOptions);
      doc.restore();

      // Draw QR (right), 1" x 1"
      let qrY = centerY - qrSize / 2;
      if (qrY < contentY) qrY = contentY;
      if (qrY + qrSize > contentY + contentHeight) {
        qrY = contentY + contentHeight - qrSize;
      }

      try {
        doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
      } catch (e) {
        console.error('Error drawing QR:', e);
      }
    }

    // 6 labels per page: 2 columns x 3 rows
    for (let i = 0; i < labels.length; i++) {
      // Start a new page at label 7, 13, 19, ...
      if (i > 0 && i % 6 === 0) {
        doc.addPage();
      }

      const indexOnPage = i % 6;            // 0..5
      const row         = Math.floor(indexOnPage / 2); // 0..2
      const col         = indexOnPage % 2;  // 0..1

      const x = leftRightMargin + col * (pidWidth + gap);
      const y = topBottomMargin + row * (pidHeight + gap);

      const { itemName, qrImageDataUrl } = labels[i];
      const qrBuffer = decodeDataUrl(qrImageDataUrl);
      if (!qrBuffer) continue;

      drawLabelWithQr(x, y, itemName, qrBuffer);
    }

    doc.end();
  } catch (error) {
    console.error('Error generating QR PID:', error);
    res.status(500).json({
      error: 'Failed to generate QR PID',
      details: error.message
    });
  }
};

// Force Node runtime (PDFKit needs Node, not Edge)
module.exports.config = { runtime: 'nodejs18.x' };
