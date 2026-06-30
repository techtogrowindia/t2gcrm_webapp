import { init, tx, id } from '@instantdb/admin';
import { opU, runOps, readData } from '../_write-ops.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
    const { ownerId, ecomName: rawName, customer, items, total } = req.body;
    const ecomName = (rawName || '').toLowerCase().trim();

    if (!ownerId || !customer || !items?.length) {
      return res.status(400).json({ error: 'Missing required fields: ownerId, customer, items' });
    }

    const orderId = id();
    const now = Date.now();

    // 1. Create the order
    const txs = [
      opU('orders', orderId, {
        userId: ownerId,
        ecomName,
        customerName: customer.name,
        customerEmail: customer.email || '',
        customerPhone: customer.phone,
        address: customer.address || '',
        notes: customer.notes || '',
        items,
        total: total || 0,
        status: 'Pending',
        createdAt: now,
      })
    ];

    // 2. Auto-create Invoice with ecom tag
    const invoiceId = id();
    const invoiceNo = `ECOM/${new Date().getFullYear()}/${Math.floor(Math.random() * 9000) + 1000}`;
    txs.push(opU('invoices', invoiceId, {
      userId: ownerId,
      no: invoiceNo,
      client: customer.name,
      clientEmail: customer.email || '',
      clientPhone: customer.phone,
      date: now,
      dueDate: now + 7 * 24 * 60 * 60 * 1000,
      items: items.map(i => ({ name: i.name, qty: i.qty, rate: i.rate, taxRate: i.tax || 0 })),
      total: total || 0,
      status: 'Unpaid',
      tag: 'ecom',
      orderId,
      createdAt: now,
    }));

    // 3. Lead/Customer Uniqueness & Matching
    const { leads = [], customers = [] } = await readData(db, ownerId, {
      leads: { $: { where: { userId: ownerId } } },
      customers: { $: { where: { userId: ownerId } } }
    });
    
    const allEntities = [...leads, ...customers];
    const pEmail = customer.email?.toLowerCase().trim();
    const pPhone = customer.phone?.trim();
    
    // Find records that match EITHER email OR phone
    const matches = allEntities.filter(e => 
      (pEmail && e.email?.toLowerCase().trim() === pEmail) ||
      (pPhone && e.phone?.trim() === pPhone)
    );

    let matchLead = null;
    if (matches.length > 0) {
      // Check for conflicts
      const conflict = matches.some(m => {
        const emailMatch = pEmail && m.email?.toLowerCase().trim() === pEmail;
        const phoneMatch = pPhone && m.phone?.trim() === pPhone;
        // Conflict if email matches but phone exists and is different, or vice versa
        if (emailMatch && pPhone && m.phone && m.phone.trim() !== pPhone) return true;
        if (phoneMatch && pEmail && m.email && m.email.toLowerCase().trim() !== pEmail) return true;
        return false;
      }) || (new Set(matches.map(m => m.id)).size > 1);

      if (conflict) {
        return res.status(400).json({ error: 'Mail ID or phone number mismatch with existing record' });
      }
      
      const found = matches[0];
      // If it's a lead, we'll update it later if needed. If it's a customer, we just link it.
      if (leads.find(l => l.id === found.id)) {
        matchLead = found;
      }
    }

    if (!matchLead && !customers.some(c => matches.some(m => m.id === c.id))) {
      // Create new lead if no lead or customer matched
      txs.push(opU('leads', id(), {
        userId: ownerId,
        name: customer.name,
        email: customer.email || '',
        phone: customer.phone,
        source: 'ecom',
        stage: 'New Enquiry',
        notes: `Ordered from e-com store: ${ecomName}`,
        createdAt: now,
      }));
    } else if (matchLead) {
      // Update existing lead
      const oldNotes = matchLead.notes || '';
      const timestampedNote = `[${new Date().toLocaleDateString('en-IN')}] Ordered from e-com store: ${ecomName} (Total: ₹${total})`;
      const newNotes = oldNotes ? `${oldNotes}\n${timestampedNote}` : timestampedNote;
      
      txs.push(opU('leads', matchLead.id, {
        name: customer.name,
        notes: newNotes,
        updatedAt: now,
      }));
    }

    // 4. Link order ID back to invoice
    txs.push(opU('orders', orderId, { invoiceId }));

    await runOps(db, ownerId, txs);

    return res.status(200).json({ success: true, orderId, invoiceId, invoiceNo });
  } catch (err) {
    console.error('Checkout API Error:', err);
    return res.status(500).json({ error: err.message || 'Checkout failed' });
  }
}
