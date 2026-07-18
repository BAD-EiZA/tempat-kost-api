import PDFDocument from 'pdfkit';

export async function textToPdfBase64(title: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);
    doc.fontSize(16).text(title, { underline: true });
    doc.moveDown();
    doc.fontSize(11).text(body, { lineGap: 4 });
    doc.end();
  });
}

export async function htmlishToPdfBase64(
  title: string,
  lines: string[],
): Promise<string> {
  return textToPdfBase64(title, lines.join('\n'));
}
