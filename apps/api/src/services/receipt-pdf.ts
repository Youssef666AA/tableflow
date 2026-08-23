import PDFDocument from 'pdfkit';
import { formatMoney } from '@tableflow/shared';

interface ReceiptSnapshot {
  number: string;
  issuedAt: string;
  restaurant: { name: string; legalName: string | null; currency: string; taxRateBps: number; serviceChargeRateBps: number };
  branch: { name: string; address: string | null; phone: string | null };
  session: { code: string; tableNumber: string; startedAt: string; guestCount: number; customerName: string | null };
  orders: Array<{
    number: number;
    placedAt: string;
    items: Array<{
      name: string;
      variantName: string | null;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
      modifiers: Array<{ name: string; priceDelta: number }>;
      notes: string | null;
    }>;
    promotions: Array<{ name: string; amount: number }>;
    total: number;
  }>;
  totals: { subtotal: number; discountTotal: number; taxTotal: number; serviceChargeTotal: number; total: number; tip: number };
  payments: Array<{ method: string; amount: number; tip: number; reference: string | null; processedAt: string | null; simulated: boolean }>;
}

const INK = '#1f2421';
const MUTED = '#6b7280';
const RULE = '#e5e7eb';

/** Renders a receipt snapshot to a PDF buffer. 80mm-style column on A4 stock. */
export function renderReceiptPdf(snapshot: ReceiptSnapshot): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const currency = snapshot.restaurant.currency;
    const money = (value: number) => formatMoney(value, currency);
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    const rule = (y?: number) => {
      const yy = y ?? doc.y;
      doc.save().strokeColor(RULE).lineWidth(1).moveTo(left, yy).lineTo(right, yy).stroke().restore();
    };

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text(snapshot.restaurant.name, { align: 'left' });
    doc.font('Helvetica').fontSize(10).fillColor(MUTED);
    doc.text(snapshot.branch.name);
    if (snapshot.branch.address) doc.text(snapshot.branch.address);
    if (snapshot.branch.phone) doc.text(snapshot.branch.phone);

    doc.moveDown(1);
    rule();
    doc.moveDown(0.8);

    const issued = new Date(snapshot.issuedAt);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(`Receipt ${snapshot.number}`);
    doc.font('Helvetica').fontSize(10).fillColor(MUTED);
    doc.text(`Table ${snapshot.session.tableNumber}   ·   Session ${snapshot.session.code}`);
    doc.text(`Issued ${issued.toLocaleString('en-GB')}`);
    if (snapshot.session.customerName) doc.text(`Guest: ${snapshot.session.customerName}`);

    doc.moveDown(1);

    for (const order of snapshot.orders) {
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(`Order #${order.number}`);
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(new Date(order.placedAt).toLocaleTimeString('en-GB'));
      doc.moveDown(0.3);

      for (const item of order.items) {
        const label = item.variantName ? `${item.name} · ${item.variantName}` : item.name;
        const y = doc.y;
        doc.fillColor(INK).font('Helvetica').fontSize(10);
        doc.text(`${item.quantity} ×  ${label}`, left, y, { width: width - 110 });
        doc.text(money(item.lineTotal), right - 110, y, { width: 110, align: 'right' });

        if (item.modifiers.length > 0) {
          doc.fillColor(MUTED).fontSize(8.5);
          doc.text(item.modifiers.map((m) => m.name).join(' · '), left + 18, doc.y, { width: width - 130 });
        }
        if (item.notes) {
          doc.fillColor(MUTED).fontSize(8.5).text(`Note: ${item.notes}`, left + 18, doc.y, { width: width - 130 });
        }
        doc.moveDown(0.35);
      }

      for (const promotion of order.promotions) {
        const y = doc.y;
        doc.fillColor('#2f7a55').font('Helvetica').fontSize(9.5);
        doc.text(promotion.name, left + 18, y, { width: width - 130 });
        doc.text(`-${money(promotion.amount)}`, right - 110, y, { width: 110, align: 'right' });
        doc.moveDown(0.3);
      }

      doc.moveDown(0.4);
    }

    rule();
    doc.moveDown(0.6);

    const totalRow = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 13 : 10);
      doc.fillColor(bold ? INK : MUTED).text(label, left, y, { width: width - 140 });
      doc.fillColor(INK).text(value, right - 140, y, { width: 140, align: 'right' });
      doc.moveDown(bold ? 0.2 : 0.35);
    };

    totalRow('Subtotal', money(snapshot.totals.subtotal));
    if (snapshot.totals.discountTotal > 0) totalRow('Discounts', `-${money(snapshot.totals.discountTotal)}`);
    if (snapshot.totals.taxTotal > 0) {
      totalRow(`VAT (${(snapshot.restaurant.taxRateBps / 100).toFixed(2)}%)`, money(snapshot.totals.taxTotal));
    }
    if (snapshot.totals.serviceChargeTotal > 0) {
      totalRow(
        `Service charge (${(snapshot.restaurant.serviceChargeRateBps / 100).toFixed(2)}%)`,
        money(snapshot.totals.serviceChargeTotal),
      );
    }
    if (snapshot.totals.tip > 0) totalRow('Tip', money(snapshot.totals.tip));

    doc.moveDown(0.3);
    rule();
    doc.moveDown(0.6);
    totalRow('Total', money(snapshot.totals.total + snapshot.totals.tip), true);

    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Payment');
    doc.font('Helvetica').fontSize(9.5).fillColor(MUTED);
    for (const payment of snapshot.payments) {
      const method = payment.method.replace(/_/g, ' ').toLowerCase();
      const suffix = payment.simulated ? '  (simulated — no real funds were transferred)' : '';
      doc.text(`${money(payment.amount)} · ${method}${payment.reference ? ` · ${payment.reference}` : ''}${suffix}`);
    }

    doc.moveDown(1.5);
    rule();
    doc.moveDown(0.6);
    doc.fontSize(9).fillColor(MUTED).text('Thank you for dining with us.', { align: 'center' });
    doc.fontSize(8).text('Generated by TableFlow — Scan. Order. Serve.', { align: 'center' });

    doc.end();
  });
}

export type { ReceiptSnapshot };
