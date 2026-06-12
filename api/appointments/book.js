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
    const { ownerId, slug, service, date, time, customer } = req.body;

    if (!ownerId || !date || !time || !customer?.name || !customer?.phone) {
      return res.status(400).json({ error: 'Missing required fields: ownerId, date, time, customer.name, customer.phone' });
    }

    // Check slot availability (Exclude Cancelled/No Show)
    const existing = await readData(db, ownerId, {
      appointments: { 
        $: { 
          where: { userId: ownerId, date, time } 
        } 
      },
      appointmentSettings: { $: { where: { userId: ownerId } } },
    });

    const settings = existing.appointmentSettings?.[0];
    const maxPerSlot = settings?.maxPerSlot || 1;
    // Filter active appointments in JS to avoid "coerced-query" validation issues
    const activeAppointments = (existing.appointments || []).filter(a => !['Cancelled', 'No Show'].includes(a.status));
    const currentCount = activeAppointments.length;

    if (currentCount >= maxPerSlot) {
      return res.status(409).json({ error: `This time slot is fully booked (max ${maxPerSlot} per slot)` });
    }

    const appointmentId = id();
    const now = Date.now();

    const txs = [
      opU('appointments', appointmentId, {
        userId: ownerId,
        slug: slug || '',
        service: service || 'General Appointment',
        date,
        time,
        customerName: customer.name,
        customerEmail: customer.email || '',
        customerPhone: customer.phone,
        notes: customer.notes || '',
        status: 'Pending',
        createdAt: now,
      })
    ];

    // 2. Lead/Customer Uniqueness & Matching
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
        source: 'appointment',
        stage: 'New Enquiry',
        notes: `Booked appointment for: ${service || 'General'} on ${date} at ${time}`,
        createdAt: now,
      }));
    } else if (matchLead) {
      // Update existing lead
      const oldNotes = matchLead.notes || '';
      const timestampedNote = `[${new Date().toLocaleDateString('en-IN')}] Booked appointment for: ${service || 'General'} on ${date} at ${time}`;
      const newNotes = oldNotes ? `${oldNotes}\n${timestampedNote}` : timestampedNote;
      
      txs.push(opU('leads', matchLead.id, {
        name: customer.name,
        notes: newNotes,
        updatedAt: now,
      }));
    }

    await runOps(db, ownerId, txs);

    return res.status(200).json({ success: true, appointmentId });
  } catch (err) {
    console.error('Appointment Book API Error:', err);
    return res.status(500).json({ error: err.message || 'Booking failed' });
  }
}
