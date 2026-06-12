import { init } from '@instantdb/admin';
import { id } from '@instantdb/react';
import { opU, runOps, readData } from './_write-ops.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!APP_ID || !ADMIN_TOKEN) {
      return res.status(500).json({ error: 'Missing InstantDB credentials' });
    }

    const { action, cart, customer, payMode, userId, actorId } = req.body || {};
    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

    if (action === 'generate-bill') {
      if (!cart || !userId || !actorId) return res.status(400).json({ error: 'Missing checkout data' });
      
      const sub = cart.reduce((s, it) => s + (it.qty * it.rate), 0);
      const taxAmt = cart.reduce((s, it) => s + (it.qty * it.rate * (it.tax || 0) / 100), 0);
      const total = Math.round(sub + taxAmt);
      const invNo = `POS-${Date.now().toString().slice(-6)}`;
      const invoiceId = id();

      const payload = {
        no: invNo,
        client: customer ? customer.name : 'Walk-in Customer',
        customerId: customer ? customer.id : null,
        date: new Date().toISOString().split('T')[0],
        items: cart.map(it => ({ name: it.name, qty: it.qty, rate: it.rate, taxRate: it.tax || 0 })),
        total, status: 'Paid', payMode, userId, actorId, createdAt: Date.now(), type: 'POS', taxAmt
      };

      const txs = [opU('invoices', invoiceId, payload)];
      const profile = (await readData(db, userId, { userProfiles: { $: { where: { userId } } } })).userProfiles?.[0] || {};
      const wonStage = profile.wonStage || 'Won';

      if (customer?.name) {
        const lMatch = ((await readData(db, userId, { leads: { $: { where: { userId } } } })).leads || []).find(l => (l.name || '').trim().toLowerCase() === (customer.name || '').trim().toLowerCase() && l.stage !== wonStage);
        if (lMatch) {
          txs.push(opU('leads', lMatch.id, { stage: wonStage, email: lMatch.email || customer.email || '', phone: lMatch.phone || customer.phone || '', stageChangedAt: Date.now() }));
          txs.push(opU('activityLogs', id(), { entityId: lMatch.id, entityType: 'lead', text: `Lead converted to Customer via POS Bill ${invNo}.`, userId, actorId, userName: actorId, createdAt: Date.now() }));
        }
      }

      const prodData = await readData(db, userId, { products: { $: { where: { userId, name: { in: cart.map(it => it.name) } } } } });
      const productsMap = (prodData.products || []).reduce((acc, p) => ({ ...acc, [p.name]: p }), {});

      for (const item of cart) {
        const dbProd = productsMap[item.name];
        if (dbProd && dbProd.trackStock) {
          const newStock = (dbProd.stock || 0) - item.qty;
          if (newStock < 0) return res.status(400).json({ error: `Insufficient stock for ${item.name}` });
          txs.push(opU('products', dbProd.id, { stock: newStock }));
          txs.push(opU('activityLogs', id(), { entityId: dbProd.id, entityType: 'product', text: `Stock reduced by ${item.qty} via POS Bill ${invNo}.`, userId, actorId, userName: 'POS System', createdAt: Date.now() }));
        }
      }

      await runOps(db, userId, txs);
      return res.status(200).json({ success: true, invoice: { id: invoiceId, ...payload } });
    }

    return res.status(405).json({ error: 'Action not allowed' });
  } catch (err) {
    console.error('Finance API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
