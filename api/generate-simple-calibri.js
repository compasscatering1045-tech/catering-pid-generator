// api/generate-simple-calibri.js
const PDFDocument = require('pdfkit');
const https = require('https');
const path = require('path');

// Function to download image from URL
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      })
      .on('error', reject);
  });
}

// --- helpers ---
const toBool = (v, d = false) =>
  typeof v === 'boolean' ? v :
  typeof v === 'string'  ? v.toLowerCase() === 'true' : d;

function parsePricePerOz(raw) {
  if (raw === null || raw === undefined) return NaN;
  let s = String(raw).trim();
  s = s.replace(/\s+/g, '').replace(/,/g, '.');
  s = s.replace(/\/oz$/i, '');
  s = s.replace(/[^0-9.]/g, '');
  const parts = s.split('.');
  if (parts.length > 2) s = parts[0] + '.' + parts.slice(1).join('');
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ✅ Make GET friendly (so pasting URL doesn’t “crash” your sanity)
  if (req.method === 'GET') {
    return res.status(200).send('OK. POST JSON to this endpoint to generate the PDF.');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse body safely
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const { orderData } = body || {};
    if (!orderData) {
      return res.status(400).json({ error: 'Missing orderData in request body' });
    }

    const menuLines = String(orderData.menuItems || '')
      .split('\n')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0);

    if (!menuLines.length) {
      return res.status(400).json({ error: 'No menu items provided' });
    }

    // PRICE
    const enablePrice = toBool(orderData.enablePrice, true);
    const priceNum = enablePrice ? parsePricePerOz(orderData.pricePerOz) : NaN;
    const shouldPrintPrice = enablePrice && Number.isFinite(priceNum);
    const formattedPrice = shouldPrintPrice ? `${priceNum.toFixed(2)}/oz` : '';

    // Background toggle
    const enableBackground = toBool(orderData.enableBackground, false);

    // Background image
    let backgroundImage = null;
    if (enableBackground) {
      const backgroundUrl =
        'https://raw.githubusercontent.com/compasscatering1045-tech/catering-pid-generator/main/background.png';
      try {
        backgroundImage = await downloadImage(backgroundUrl);
      } catch (e) {
        console.error('downloadImage failed:', e?.message || e);
        backgroundImage = null;
      }
    }

    const doc = new PDFDocument({ size: 'LETTER', margin: 36 });

    // ✅ Vercel-safe font paths (relative to project root)
    const calibriPath = path.join(process.cwd(), 'fonts', 'Calibri.ttf');
    const calibriBoldPath = path.join(process.cwd(), 'fonts', 'Calibri-Bold.ttf');

    // ✅ Register fonts (if missing, this will throw; logs will show the path)
    doc.registerFont('Calibri', calibriPath);
    doc.registerFont('Calibri-Bold', calibriBoldPath);

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="pid-simple-labels.pdf"');
      res.status(200).send(pdfBuffer);
    });

    // Geometry
    const leftRightMargin = 72;
    const topBottomMargin = 36;
    const pidWidth = 216;   // 3"
    const pidHeight = 216;  // 3"
    const gap = 36;
    const perPage = 6;

    function drawPid(x, y, menuItem) {
      if (!menuItem) return;

      if (enableBackground && backgroundImage) {
        doc.save();
        doc.rect(x, y, pidWidth, pidHeight).clip();
        try {
          doc.image(backgroundImage, x, y, { width: pidWidth, height: pidHeight });
        } catch (imgError) {
          console.error('Error adding image:', imgError);
        }
        doc.restore();
      }

      const itemY = y + Math.round(pidHeight * 0.40);
      const priceY = itemY + 28;

      // ✅ MENU: Calibri Bold 20
      doc.fillColor('black')
        .font('Calibri-Bold')
        .fontSize(20)
        .text(menuItem, x, itemY, {
          width: pidWidth,
          align: 'center',
          lineBreak: true
        });

      // ✅ PRICE: Calibri 20
      if (shouldPrintPrice) {
        doc.fillColor('#333')
          .font('Calibri')
          .fontSize(20)
          .text(formattedPrice, x, priceY, {
            width: pidWidth,
            align: 'center'
          });
      }
    }

    for (let i = 0; i < menuLines.length; i++) {
      if (i > 0 && i % perPage === 0) doc.addPage();

      const slot = i % perPage;
      const row = Math.floor(slot / 2);
      const col = slot % 2;

      const x = leftRightMargin + col * (pidWidth + gap);
      const y = topBottomMargin + row * (pidHeight + gap);

      drawPid(x, y, menuLines[i]);
    }

    doc.end();
  } catch (error) {
    console.error('Error generating PID:', error);
    res.status(500).json({
      error: 'Failed to generate PID',
      details: error.message
    });
  }
};
