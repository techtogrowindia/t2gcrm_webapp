import { init, tx, id } from '@instantdb/admin';
import { opU, runOps, readData } from './_write-ops.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

/**
 * Attendance API for Android App check-in / check-out.
 *
 * Endpoints:
 *   GET  /api/attendance?ownerId=xxx                        - List attendance records
 *   GET  /api/attendance?ownerId=xxx&staffEmail=x&date=x    - Get specific day record
 *   POST /api/attendance  { action:'checkin', ownerId, staffEmail, staffName, lat, lng, address }
 *   POST /api/attendance  { action:'checkout', ownerId, staffEmail, lat, lng, address }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (!APP_ID || !ADMIN_TOKEN) {
      return res.status(500).json({ error: 'Missing InstantDB configuration' });
    }

    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
    const { method } = req;
    const params = { ...req.query, ...(req.body || {}) };
    const { ownerId } = params;

    if (!ownerId) {
      return res.status(400).json({ error: 'ownerId is required' });
    }

    /* ── GET: List attendance records ── */
    if (method === 'GET') {
      const { attendance } = await readData(db, ownerId, {
        attendance: { $: { where: { userId: ownerId } } },
      });

      let records = attendance || [];

      // Filter by staff email
      if (params.staffEmail) {
        records = records.filter(r => r.staffEmail === params.staffEmail);
      }

      // Filter by date (single day)
      if (params.date) {
        records = records.filter(r => r.date === params.date);
      }

      // Filter by date range
      if (params.dateFrom) {
        records = records.filter(r => r.date >= params.dateFrom);
      }
      if (params.dateTo) {
        records = records.filter(r => r.date <= params.dateTo);
      }

      // Sort by date desc, then checkInTime desc
      records.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return (b.checkInTime || 0) - (a.checkInTime || 0);
      });

      return res.status(200).json({ success: true, data: records, count: records.length });
    }

    /* ── POST: Check-in or Check-out ── */
    if (method === 'POST') {
      const { action, staffEmail, staffName, lat, lng, address } = params;

      if (!staffEmail) {
        return res.status(400).json({ error: 'staffEmail is required' });
      }

      const todayStr = new Date().toISOString().split('T')[0];

      if (action === 'checkin') {
        // Check if already checked in today
        const { attendance } = await readData(db, ownerId, {
          attendance: { $: { where: { userId: ownerId } } },
        });
        const existing = (attendance || []).find(
          r => r.staffEmail === staffEmail && r.date === todayStr && !r.checkOutTime
        );

        if (existing) {
          return res.status(409).json({
            error: 'Already checked in today. Please check out first.',
            record: existing,
          });
        }

        const newId = id();
        const now = Date.now();
        await runOps(db, ownerId, [opU('attendance', newId, {
          staffEmail,
          staffName: staffName || '',
          date: todayStr,
          checkInTime: now,
          checkInLat: lat ? Number(lat) : null,
          checkInLng: lng ? Number(lng) : null,
          checkInAddress: address || '',
          checkOutTime: null,
          checkOutLat: null,
          checkOutLng: null,
          checkOutAddress: '',
          totalHours: null,
          userId: ownerId,
          actorId: params.actorId || ownerId,
          createdAt: now,
          updatedAt: now,
        })]);

        return res.status(201).json({ success: true, id: newId, message: 'Checked in successfully' });
      }

      if (action === 'checkout') {
        // Find today's open check-in
        const { attendance } = await readData(db, ownerId, {
          attendance: { $: { where: { userId: ownerId } } },
        });
        const openRecord = (attendance || []).find(
          r => r.staffEmail === staffEmail && r.date === todayStr && r.checkInTime && !r.checkOutTime
        );

        if (!openRecord) {
          return res.status(404).json({ error: 'No open check-in found for today. Please check in first.' });
        }

        const now = Date.now();
        const totalHours = Math.round(((now - openRecord.checkInTime) / (1000 * 60 * 60)) * 100) / 100;

        await runOps(db, ownerId, [opU('attendance', openRecord.id, {
          checkOutTime: now,
          checkOutLat: lat ? Number(lat) : null,
          checkOutLng: lng ? Number(lng) : null,
          checkOutAddress: address || '',
          totalHours,
          updatedAt: now,
        })]);

        return res.status(200).json({
          success: true,
          message: 'Checked out successfully',
          totalHours,
        });
      }

      return res.status(400).json({ error: 'Invalid action. Use "checkin" or "checkout".' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Attendance API Error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
