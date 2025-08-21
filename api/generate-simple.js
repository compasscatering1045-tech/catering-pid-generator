// api/generate-simple.js - SIMPLIFIED VERSION FOR PRICE LABELS
const PDFDocument = require('pdfkit');
const https = require('https');

// Function to download image from URL
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
  });
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
    const { orderData } = req.body;
    
    if (!orderData) {
      return res.status(400).json({ error: 'Missing orderData in request body' });
    }

    // Download the background image
    const backgroundUrl = 'https://raw.githubusercontent.com/compasscatering1045-tech/catering-pid-generator/main/background.png';
    const backgroundImage = await downloadImage(backgroundUrl);

    // Parse menu items
    const menuLines = orderData.menuItems.split('\n').map(item => {
      return item.trim().toLowerCase();
    }).filter(item => item.length > 0);

    // Get price per lb (use the one provided or extract from special instructions)
    const pricePerLb = orderData.pricePerLb || orderData.specialInstructions || '$0.00';

    // Create PDF
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: 36 // 0.5 inch margins
    });

    // Buffer to collect PDF data
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="pid-simple-labels.pdf"`);
      res.status(200).send(pdfBuffer);
    });

    // PDF dimensions
    const pageWidth = 612; // 8.5 inches in points
    const pageHeight = 792; // 11 inches in points
    const leftRightMargin = 72; // 1 inch margins on left and right
    const topBottomMargin = 36; // 0.5 inch margins on top and bottom
    const pidWidth = 216; // 3 inches in points (3 * 72)
    const pidHeight = 216; // 3 inches in points (3 * 72)
    const gap = 36; // 0.5 inch gap between PIDs

    // Draw 6 PIDs (2 columns x 3 rows)
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 2; col++) {
        const x = leftRightMargin + col * (pidWidth + gap);
        const y = topBottomMargin + row * (pidHeight + gap);
        const menuIndex = (row * 2 + col) % menuLines.length;
        const menuItem = menuLines[menuIndex] || '';

        // Skip if no menu item
        if (!menuItem) continue;

        // Add background image - exact size, no stretching
        doc.save();
        
        // Set clipping region to PID bounds
        doc.rect(x, y, pidWidth, pidHeight).clip();
        
        // Place background image
        try {
          doc.image(backgroundImage, x, y, {
            width: pidWidth,
            height: pidHeight
          });
        } catch (imgError) {
          console.error('Error adding image:', imgError);
        }
        
        doc.restore();

        // Calculate vertical centering
        // We want the text to be centered in the PID
        const totalTextHeight = 60; // Approximate height for item name + price
        const startY = y + (pidHeight - totalTextHeight) / 2;

        // Add menu item name - centered, larger font
        doc.fillColor('black')
           .font('Helvetica-Bold')
           .fontSize(16)
           .text(menuItem, 
                 x,
                 startY,
                 {
                   width: pidWidth,
                   align: 'center',
                   lineBreak: true
                 });

        // Add price below - centered, smaller font
        doc.fillColor('#333')
           .font('Helvetica')
           .fontSize(12)
           .text(pricePerLb,
                 x,
                 startY + 30, // Space below the item name
                 {
                   width: pidWidth,
                   align: 'center'
                 });
      }
    }

    // Finalize PDF
    doc.end();

  } catch (error) {
    console.error('Error generating PID:', error);
    res.status(500).json({ error: 'Failed to generate PID', details: error.message });
  }
};