// File: src/services/report.js
import PDFDocument from 'pdfkit';
import { User, Pyq, Delivery } from '../db/models.js';

export async function makeOverviewPdf() {
  const [students, active, documents, accepted, uncertain, topSubjects] = await Promise.all([
    User.countDocuments({ optedOut: false }), User.countDocuments({ state: 'ACTIVE', optedOut: false }),
    Pyq.countDocuments(), Delivery.countDocuments({ status: 'accepted' }),
    Delivery.countDocuments({ status: 'uncertain' }),
    Delivery.aggregate([{ $match: { status: 'accepted' } },
      { $lookup: { from: Pyq.collection.name, localField: 'pyqId', foreignField: '_id', as: 'pyq' } },
      { $unwind: '$pyq' }, { $group: { _id: '$pyq.subjectCode', count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 10 }])
  ]);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 54 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.fontSize(21).text('BEUnights PYQ — Admin Overview');
    doc.moveDown().fontSize(10).text(`Generated: ${new Date().toISOString()}`);
    doc.moveDown().fontSize(12);
    doc.text(`Registered non-opted-out profiles: ${students}`);
    doc.text(`Active registered profiles: ${active}`);
    doc.text(`PYQ documents indexed: ${documents}`);
    doc.text(`WhatsApp sends accepted by API: ${accepted}`);
    doc.text(`Uncertain sends requiring review: ${uncertain}`);
    doc.moveDown().fontSize(14).text('Top requested subjects (accepted sends)');
    doc.fontSize(11);
    for (const item of topSubjects) doc.text(`${item._id}: ${item.count}`);
    doc.moveDown().fontSize(9).text('Note: accepted != delivered/read. No student phone numbers are exported.');
    doc.end();
  });
}
