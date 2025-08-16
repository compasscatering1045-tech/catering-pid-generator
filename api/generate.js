// api/generate.js - SIMPLE VERSION WITHOUT PUPPETEER
const PDFDocument = require('pdfkit');

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
    const pageWidth = 612; // 8.5 inches
    const pageHeight = 792; // 11 inches
    const margin = 36; // 0.5 inch
    const pidWidth = 261; // 3.625 inches
    const pidHeight = 234; // 3.25 inches
    const gap = 18; // 0.25 inch

    // Draw 6 PIDs (2 columns x 3 rows)
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 2; col++) {
        const x = margin + col * (pidWidth + gap);
        const y = margin + row * (pidHeight + gap);
        const menuIndex = (row * 2 + col) % menuLines.length;
        const menuItem = menuLines[menuIndex] || 'menu item';

        // Draw border (optional)
        doc.rect(x, y, pidWidth, pidHeight).stroke('#e0e0e0');

        // Draw wave pattern (simplified)
        doc.save();
        doc.strokeColor('#a8d0e8').lineWidth(2).strokeOpacity(0.4);
        
        // Draw some wavy lines
        for (let i = 0; i < 3; i++) {
          doc.moveTo(x + 20, y + 80 + i * 20);
          doc.bezierCurveTo(
            x + 80, y + 70 + i * 20,
            x + 140, y + 90 + i * 20,
            x + 200, y + 80 + i * 20
          ).stroke();
        }
        
        // Draw spiral
        const centerX = x + pidWidth - 60;
        const centerY = y + 70;
        doc.circle(centerX, centerY, 20).stroke();
        
        // Inner spiral
        doc.moveTo(centerX, centerY);
        let angle = 0;
        let radius = 2;
        for (let i = 0; i < 50; i++) {
          angle += 0.3;
          radius += 0.3;
          const sx = centerX + Math.cos(angle) * radius;
          const sy = centerY + Math.sin(angle) * radius;
          doc.lineTo(sx, sy);
        }
        doc.stroke();
        doc.restore();

        // Add menu text
        doc.fillColor('black')
           .font('Helvetica-Bold')
           .fontSize(14)
           .text(menuItem, x, y + pidHeight / 2 - 10, {
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

// package.json for simple version
{
  "name": "catering-pid-generator",
  "version": "1.0.0",
  "description": "Generate PID labels for catering orders",
  "dependencies": {
    "pdfkit": "^0.13.0"
  }
}
