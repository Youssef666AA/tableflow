import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { env } from '../env.js';
import { generateQrToken } from '../lib/crypto.js';
import { prisma } from '../lib/prisma.js';
import { writeAudit } from './audit.js';

/**
 * The printed QR encodes nothing but a URL carrying a 256-bit random token.
 * No table number, no branch id, nothing an attacker could edit into another
 * table's code.
 */
export function qrUrlFor(token: string): string {
  return `${env.WEB_URL.replace(/\/$/, '')}/t/${token}`;
}

export async function renderQrPng(token: string, size = 512): Promise<Buffer> {
  return QRCode.toBuffer(qrUrlFor(token), {
    type: 'png',
    width: size,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#1f2421ff', light: '#ffffffff' },
  });
}

export async function renderQrSvg(token: string): Promise<string> {
  return QRCode.toString(qrUrlFor(token), {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#1f2421', light: '#ffffff' },
  });
}

export async function ensureQrToken(tableId: string): Promise<{ id: string; token: string }> {
  const existing = await prisma.tableQrToken.findFirst({
    where: { tableId, active: true },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return { id: existing.id, token: existing.token };

  const created = await prisma.tableQrToken.create({
    data: { tableId, token: generateQrToken() },
  });
  return { id: created.id, token: created.token };
}

/**
 * Rotates a table's QR token. The previous row is revoked in the same
 * transaction, so a printed code that is still on a table stops working the
 * instant the new one is generated.
 */
export async function regenerateQrToken(params: {
  tableId: string;
  userId: string;
  restaurantId: string;
  branchId: string;
  reason?: string | null;
}): Promise<{ id: string; token: string; url: string }> {
  const created = await prisma.$transaction(async (tx) => {
    await tx.tableQrToken.updateMany({
      where: { tableId: params.tableId, active: true },
      data: { active: false, revokedAt: new Date() },
    });
    return tx.tableQrToken.create({
      data: { tableId: params.tableId, token: generateQrToken(), createdById: params.userId },
    });
  });

  void writeAudit({
    action: 'table.qr_regenerated',
    entity: 'RestaurantTable',
    entityId: params.tableId,
    restaurantId: params.restaurantId,
    branchId: params.branchId,
    actorType: 'STAFF',
    actorUserId: params.userId,
    metadata: { reason: params.reason ?? null, tokenId: created.id },
  });

  return { id: created.id, token: created.token, url: qrUrlFor(created.token) };
}

export async function deactivateQrToken(tableId: string, userId: string): Promise<void> {
  await prisma.tableQrToken.updateMany({
    where: { tableId, active: true },
    data: { active: false, revokedAt: new Date() },
  });
  void writeAudit({
    action: 'table.qr_deactivated',
    entity: 'RestaurantTable',
    entityId: tableId,
    actorType: 'STAFF',
    actorUserId: userId,
  });
}

interface SheetTable {
  number: string;
  label: string | null;
  token: string;
}

/** Printable QR sheet: two per row, cut lines, restaurant name and instructions. */
export async function renderQrSheetPdf(params: {
  restaurantName: string;
  branchName: string;
  tables: SheetTable[];
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const cardWidth = pageWidth / 2;
  const cardHeight = 268;
  const perPage = 6;

  for (let i = 0; i < params.tables.length; i += 1) {
    const table = params.tables[i];
    const indexOnPage = i % perPage;
    if (i > 0 && indexOnPage === 0) doc.addPage();

    const col = indexOnPage % 2;
    const row = Math.floor(indexOnPage / 2);
    const x = doc.page.margins.left + col * cardWidth;
    const y = doc.page.margins.top + row * cardHeight;

    doc
      .save()
      .strokeColor('#e5e7eb')
      .lineWidth(0.8)
      .dash(3, { space: 3 })
      .rect(x + 6, y + 6, cardWidth - 12, cardHeight - 12)
      .stroke()
      .restore();

    const png = await renderQrPng(table.token, 480);
    const qrSize = 150;
    doc.image(png, x + (cardWidth - qrSize) / 2, y + 58, { width: qrSize, height: qrSize });

    doc
      .fillColor('#1f2421')
      .font('Helvetica-Bold')
      .fontSize(15)
      .text(params.restaurantName, x + 12, y + 22, { width: cardWidth - 24, align: 'center' });

    doc
      .fillColor('#2f7a55')
      .font('Helvetica-Bold')
      .fontSize(26)
      .text(`Table ${table.number}`, x + 12, y + 218, { width: cardWidth - 24, align: 'center' });

    doc
      .fillColor('#6b7280')
      .font('Helvetica')
      .fontSize(9)
      .text('Scan to view the menu and order', x + 12, y + 248, {
        width: cardWidth - 24,
        align: 'center',
      });
  }

  if (params.tables.length === 0) {
    doc.fontSize(12).fillColor('#6b7280').text('No tables selected.');
  }

  doc.end();
  return done;
}
