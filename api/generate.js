// api/generate.js - WITH EXACT DESIGN SPECIFICATIONS
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
      return item.replace(/^\d+\s*x\s*/i, '').toLowerCase().trim();
    }).filter(item => item.length > 0);

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
      res.setHeader('Content-Disposition', `attachment; filename="pid-${orderData.orderNumber}.pdf"`);
      res.status(200).send(pdfBuffer);
    });

    // PDF dimensions
    const pageWidth = 612; // 8.5 inches in points
    const pageHeight = 792; // 11 inches in points
    const margin = 36; // 0.5 inch
    const pidWidth = 216; // 3 inches in points (3 * 72)
    const pidHeight = 216; // 3 inches in points (3 * 72)
    const gap = 18; // 0.25 inch
    const textPaddingTop = 18; // 1/4 inch from top
    const textPaddingLR = 18; // 1/4 inch padding left and right

    // Draw 6 PIDs (2 columns x 3 rows)
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 2; col++) {
        const x = margin + col * (pidWidth + gap);
        const y = margin + row * (pidHeight + gap);
        const menuIndex = (row * 2 + col) % menuLines.length;
        const menuItem = menuLines[menuIndex] || 'menu item';

        // NO BORDER - removed the rect().stroke() line

        // Add background image - exact size, no stretching
        doc.save();
        
        // Set clipping region to PID bounds
        doc.rect(x, y, pidWidth, pidHeight).clip();
        
        // Image is 900x900px at 300dpi = 3"x3" = 216x216 points
        // Place it exactly at the PID position
        try {
          doc.image(backgroundImage, x, y, {
            width: pidWidth,  // 216 points = 3 inches
            height: pidHeight // 216 points = 3 inches
          });
        } catch (imgError) {
          console.error('Error adding image:', imgError);
        }
        
        doc.restore();

        // Add menu text - 1/4" from top with 1/4" padding on sides
        doc.fillColor('black')
           .font('Helvetica-Bold')
           .fontSize(14)
           .text(menuItem, 
                 x + textPaddingLR,  // Left padding
                 y + textPaddingTop,  // Top padding
                 {
                   width: pidWidth - (textPaddingLR * 2), // Account for padding on both sides
                   align: 'center',
                   lineBreak: true,
                   height: pidHeight - textPaddingTop - 18 // Leave some bottom space
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
