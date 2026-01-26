import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { orderData } = req.body;

    const doc = new PDFDocument({
      size: 'LETTER',
      margin: 36
    });

    // ✅ Register Calibri fonts
    doc.registerFont('Calibri', 'fonts/Calibri.ttf');
    doc.registerFont('Calibri-Bold', 'fonts/Calibri-Bold.ttf');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=pid-labels.pdf');

    doc.pipe(res);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const pidWidth = pageWidth / 3;
    const pidHeight = 180;

    const items = orderData.menuItems
      .split('\n')
      .map(i => i.trim())
      .filter(Boolean);

    let x = doc.page.margins.left;
    let y = doc.page.margins.top;

    for (let i = 0; i < items.length; i++) {
      await drawPid(
        doc,
        x,
        y,
        pidWidth,
        pidHeight,
        items[i],
        orderData.pricePerOz,
        orderData.enablePrice,
        orderData.enableBackground
      );

      x += pidWidth;

      if (x + pidWidth > doc.page.width - doc.page.margins.right) {
        x = doc.page.margins.left;
        y += pidHeight;

        if (y + pidHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          y = doc.page.margins.top;
        }
      }
    }

    doc.end();

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'PDF generation failed' });
  }
}

async function drawPid(
  doc,
  x,
  y,
  pidWidth,
  pidHeight,
  menuItem,
  pricePerOz,
  enablePrice,
  enableBackground
) {

  if (enableBackground) {
    doc.save()
      .rect(x, y, pidWidth, pidHeight)
      .fill('#f3f7f5')
      .restore();
  }

  doc.rect(x, y, pidWidth, pidHeight).stroke('#066224');

  const qrSize = 70;
  const qrData = `PID:${menuItem}`;

  const qrImage = await QRCode.toDataURL(qrData);

  doc.image(qrImage, x + pidWidth / 2 - qrSize / 2, y + 12, {
    width: qrSize,
    height: qrSize
  });

  const itemY = y + qrSize + 30;

  // ✅ MENU ITEM — CALIBRI 20
  doc.fillColor('black')
    .font('Calibri-Bold')
    .fontSize(20)
    .text(menuItem, x + 6, itemY, {
      width: pidWidth - 12,
      align: 'center',
      lineBreak: true
    });

  if (enablePrice && pricePerOz) {
    const formattedPrice = `${pricePerOz}/oz`;

    const priceY = itemY + 28;

    // ✅ PRICE — CALIBRI 20
    doc.fillColor('#333')
      .font('Calibri')
      .fontSize(20)
      .text(formattedPrice, x + 6, priceY, {
        width: pidWidth - 12,
        align: 'center'
      });
  }
}
