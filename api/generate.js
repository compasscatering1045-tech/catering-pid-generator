// api/generate.js
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

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
    
    // Generate HTML for PIDs
    const html = generatePIDHTML(orderData);
    
    // Launch Puppeteer with Sparticuz Chromium
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    // Generate PDF
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: {
        top: '0.5in',
        bottom: '0.5in',
        left: '0.5in',
        right: '0.5in'
      }
    });

    await browser.close();

    // Send PDF back
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="pid-${orderData.orderNumber}.pdf"`);
    res.status(200).send(pdf);

  } catch (error) {
    console.error('Error generating PID:', error);
    res.status(500).json({ error: 'Failed to generate PID', details: error.message });
  }
};

function generatePIDHTML(orderData) {
  // Parse menu items - just get the item names
  const menuLines = orderData.menuItems.split('\n').map(item => {
    return item.replace(/^\d+\s*x\s*/i, '').toLowerCase().trim();
  }).filter(item => item.length > 0);

  // Create PIDs with just the menu item name
  const pids = [];
  
  // URL to your background image on GitHub (raw content)
  const backgroundUrl = 'https://raw.githubusercontent.com/compasscatering1045-tech/catering-pid-generator/main/background.png';
  
  // Generate 6 PIDs (can be different menu items or repeated)
  for (let i = 0; i < 6; i++) {
    const menuItem = menuLines[i % menuLines.length] || 'menu item';
    pids.push(`
      <div class="pid">
        <div class="menu-text">${menuItem}</div>
      </div>
    `);
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        @page {
          size: letter;
          margin: 0.5in;
        }
        
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: Arial, Helvetica, sans-serif;
          font-weight: bold;
          width: 8.5in;
          height: 11in;
          padding: 0.5in;
        }
        
        .container {
          width: 7.5in;
          height: 10in;
          display: grid;
          grid-template-columns: repeat(2, 3.625in);
          grid-template-rows: repeat(3, 3.25in);
          gap: 0.25in;
        }
        
        .pid {
          width: 3.625in;
          height: 3.25in;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }
        
        .wave-bg {
          position: absolute;
          width: 100%;
          height: 100%;
          top: 0;
          left: 0;
          z-index: 1;
        }
        
        .menu-text {
          position: relative;
          z-index: 2;
          font-size: 14pt;
          font-weight: bold;
          color: #000;
          text-align: center;
          padding: 0 20px;
          line-height: 1.3;
          max-width: 90%;
          word-wrap: break-word;
        }
        
        @media print {
          body {
            margin: 0;
            padding: 0.5in;
          }
          
          .container {
            page-break-inside: avoid;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        ${pids.join('')}
      </div>
    </body>
    </html>
  `;
}

// README.md
# Catering PID Generator

## Setup Instructions

1. **Install Vercel CLI**
   ```bash
   npm install -g vercel
   ```

2. **Clone this project**
   ```bash
   git clone [your-repo]
   cd catering-pid-generator
   ```

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Add your compass rose image**
   - Convert your PNG to base64: https://www.base64-image.de/
   - Replace `YOUR_BASE64_COMPASS_ROSE_HERE` in api/generate.js

5. **Deploy to Vercel**
   ```bash
   vercel
   ```
   Follow the prompts (accept all defaults)

6. **Get your URL**
   Your API will be available at:
   ```
   https://your-project-name.vercel.app/api/generate
   ```

7. **Update n8n workflow**
   Replace the PID webhook URL with your Vercel URL

## Testing

Send a POST request with:
```json
{
  "orderData": {
    "orderNumber": "17752",
    "customerName": "Susan",
    "phone": "954-851-6378",
    "date": "2024-07-10",
    "time": "12:45 PM",
    "location": "North 3-3061",
    "menuItems": "8 x House Chips\n8 x Dessert Tray\n8 x Fresh Fruit",
    "specialInstructions": "None"
  }
}
```

## Local Development

```bash
vercel dev
```
This runs the function locally at http://localhost:3000/api/generate

