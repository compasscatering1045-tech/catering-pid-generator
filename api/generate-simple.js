// api/generate-simple.js - SIMPLIFIED VERSION FOR PRICE LABELS (UPDATED)
const PDFDocument = require('pdfkit');
const https = require('https');

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

/**
 * Accepts:
 *  - "0.72" -> 0.72
 *  - "0.72/oz" -> 0.72
 *  - " 0.72 /oz " -> 0.72
 * Returns: Number or NaN
 */
function parsePricePerOz(raw) {
  if (raw === null || raw === undefined) return NaN;
  let s = String(raw).trim();

  // strip whitespace, commas -> dots
  s = s.replace(/\s+/g, '').replace(/,/g, '.');

  // remove trailing "/oz" if present (prevents "/oz/oz")
  s = s.replace(/\/oz$/i, '');

  // keep digits + dot only
  s = s.replace(/[^0-9.]/g, '');

  // collapse multiple dots (e.g. "1.2.3" -> "1.23")
  const parts = s.split('.');
  if (parts.length > 2) s = parts[0] + '.' + parts.slice(1).join('');

  if (!s) return NaN;

  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

module.exports = async (req, res) => {
  // Enable CORS for all origins
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Vercel usually parses JSON, but be safe if req.body is a string
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const { orderData } = body || {};

    if (!orderData) {
      return res.status(400).json({ error: 'Missing orderData in request body' });
    }

    // Parse menu items
    const menuLines = String(orderData.menuItems || '')
      .split('\n')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0);

    if (!menuLines.length) {
      return res.status(400).json({ error: 'No menu items provided' });
    }

    // --- PRICE LOGIC (FIXED) ---
    // Frontend should send: enablePrice: true/false
    // If enablePrice is false => DO NOT PRINT PRICE (no 0.00/oz)
    // If enablePrice is true and price parses => PRINT "0.72/oz" (no /oz/oz)
    const enablePrice = toBool(orderData.enablePrice, true);
    const priceNum = enablePrice ? parsePricePerOz(orderData.pricePerOz) : NaN;
    const shouldPrintPrice = enablePrice && Number.isFinite(priceNum);

    // Format only when printing
    const formattedPrice = shouldPrintPrice ? `${priceNum.toFixed(2)}/oz` : '';

    // Background toggle
    const enableBackground = toBool(orderData.enableBackground, false);

    // Download background image only if enabled
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

    // Create PDF
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: 36 // 0.5 inch margins
    });

    // Buffer to collect PDF data
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="pid-simple-labels.pdf"');
      res.status(200).send(pdfBuffer);
    });

    // PDF dimensions (LETTER)
    const leftRightMargin = 72; // 1 inch margins on left and right
    const topBottomMargin = 36; // 0.5 inch margins on top and bottom
    const pidWidth = 216; // 3 inches in points
    const pidHeight = 216; // 3 inches in points
    const gap = 36; // 0.5 inch gap between PIDs

    // Draw 6 PIDs (2 columns x 3 rows)
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 2; col++) {
        const x = leftRightMargin + col * (pidWidth + gap);
        const y = topBottomMargin + row * (pidHeight + gap);

        const menuIndex = (row * 2 + col) % menuLines.length;
        const menuItem = menuLines[menuIndex] || '';
        if (!menuItem) continue;

        // Add background image only if enabled
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

        // Text positioning
        // Menu item around 40% down from top (instead of 50%)
        const itemY = y + Math.round(pidHeight * 0.40);

        // Price shown below item only if enabled & valid
        const priceY = itemY + 28; // tighter than 0.5" to look nicer

        // Add menu item name - 14pt bold
        doc.fillColor('black')
          .font('Helvetica-Bold')
          .fontSize(14)
          .text(menuItem, x, itemY, {
            width: pidWidth,
            align: 'center',
            lineBreak: true
          });

        // Add price below - centered (ONLY when shouldPrintPrice)
        if (shouldPrintPrice) {
          doc.fillColor('#333')
            .font('Helvetica')
            .fontSize(12)
            .text(formattedPrice, x, priceY, {
              width: pidWidth,
              align: 'center'
            });
        }
      }
    }

    doc.end();
  } catch (error) {
    console.error('Error generating PID:', error);
    res.status(500).json({ error: 'Failed to generate PID', details: error.message });
  }
};
