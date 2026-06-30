import { init, tx, id } from '@instantdb/admin';
import bcrypt from 'bcrypt';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (!APP_ID || !ADMIN_TOKEN) {
      return res.status(500).json({ error: 'Missing InstantDB App ID or Admin Token in backend' });
    }

    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
    const { action, email, password, otp, fullName, bizName, phone, selectedPlan, newPassword, userId, code, ownerUserId, teamMemberId, partnerId, ownerId } = req.method === 'POST' ? req.body : req.query;

    if (!action) return res.status(400).json({ error: 'Action is required' });

    const cleanEmail = email?.trim().toLowerCase();

    /* ──────────── LOGIN ──────────── */
    if (action === 'login') {
      if (!cleanEmail || !password) return res.status(400).json({ error: 'Email and password are required' });
      const data = await db.query({ userCredentials: { $: { where: { email: cleanEmail } } } });
      let user = data.userCredentials?.[0];

      // If multiple credentials exist (e.g. owner + team), prefer the non-team one
      if (data.userCredentials?.length > 1) {
        user = data.userCredentials.find(c => !c.isTeamMember && !c.isPartner) || data.userCredentials[0];
      }

      if (!user) {
        // Check if user exists via profile (magic-code registered) but has no password credentials
        const { userProfiles } = await db.query({ userProfiles: { $: { where: { email: cleanEmail }, limit: 1 } } });
        if (userProfiles?.[0]) {
          return res.status(401).json({ error: 'No password set for this account. Please use Magic Code to sign in, or use Forgot Password to set one.' });
        }
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      if (!user.password || !(await bcrypt.compare(password, user.password))) {
        console.log(`[Auth] Login failed for ${cleanEmail} — password mismatch. Has password: ${!!user.password}, isTeamMember: ${user.isTeamMember}, isVerified: ${user.isVerified}`);
        return res.status(401).json({ error: 'Invalid email or password. Try using Forgot Password to reset it.' });
      }
      if (user.isVerified === false) {
        // Check if admin already created a profile for this user — if so, auto-verify credentials
        const { userProfiles } = await db.query({ userProfiles: { $: { where: { email: cleanEmail }, limit: 1 } } });
        if (userProfiles?.[0]) {
          await db.transact([tx.userCredentials[user.id].update({ isVerified: true, otp: null })]);
        } else if (user.isTeamMember) {
          // Team members don't have userProfiles — check teamMembers instead
          const { teamMembers } = await db.query({ teamMembers: { $: { where: { email: cleanEmail }, limit: 1 } } });
          if (teamMembers?.[0]) {
            await db.transact([tx.userCredentials[user.id].update({ isVerified: true, otp: null })]);
          } else {
            return res.status(403).json({ error: 'Email verification pending', message: 'Please verify your email using the OTP sent during registration.' });
          }
        } else if (user.isPartner) {
          // Partners don't have userProfiles — check partnerApplications instead
          const { partnerApplications } = await db.query({ partnerApplications: { $: { where: { email: cleanEmail, status: 'Approved' }, limit: 1 } } });
          if (partnerApplications?.[0]) {
            await db.transact([tx.userCredentials[user.id].update({ isVerified: true, otp: null })]);
          } else {
            return res.status(403).json({ error: 'Email verification pending', message: 'Please verify your email using the OTP sent during registration.' });
          }
        } else {
          return res.status(403).json({ error: 'Email verification pending', message: 'Please verify your email using the OTP sent during registration.' });
        }
      }
      
      const token = await db.auth.createToken({ email: cleanEmail });

      // Check if this email belongs to a business owner (owner takes priority over team member)
      const { userProfiles: ownerCheck } = await db.query({ userProfiles: { $: { where: { email: cleanEmail }, limit: 1 } } });
      const isOwnerAccount = !!ownerCheck?.[0];

      const isTeamMember = !!(user.isTeamMember && user.ownerUserId) && !isOwnerAccount;
      const isPartner = !!(user.isPartner && user.ownerUserId) && !isOwnerAccount;

      // Auto-repair: if owner credential was corrupted with team/partner flags, clean it up
      if (isOwnerAccount && (user.isTeamMember || user.isPartner)) {
        await db.transact([tx.userCredentials[user.id].update({ isTeamMember: false, isPartner: false, ownerUserId: null, teamMemberId: null, partnerId: null })]);
      }

      let role = 'Owner', perms = null, finalOwnerId = isTeamMember || isPartner ? user.ownerUserId : null, finalTeamId = isTeamMember ? user.teamMemberId : null, finalPartnerId = isPartner ? user.partnerId : null;

      if (isTeamMember) {
        const { teamMembers, userProfiles } = await db.query({
          teamMembers: { $: { where: { email: cleanEmail, userId: user.ownerUserId }, limit: 1 } },
          userProfiles: { $: { where: { userId: user.ownerUserId }, limit: 1 } }
        });
        const member = teamMembers?.[0];
        const profile = userProfiles?.[0];
        if (member && profile) {
          role = member.role;
          perms = (profile.roles || []).find(r => r.name === member.role)?.perms || {};
        }
      } else if (isPartner) {
        const { partnerApplications } = await db.query({
          partnerApplications: { $: { where: { id: user.partnerId }, limit: 1 } }
        });
        const partner = partnerApplications?.[0];
        if (partner) {
          role = partner.role; // 'Distributor' or 'Retailer'
          // Partners don't use the standard generic permissions system, their access is hardcoded by role
        }
      } else {
        const { userProfiles } = await db.query({ userProfiles: { $: { where: { email: cleanEmail }, limit: 1 } } });
        if (userProfiles?.[0]) {
          finalOwnerId = userProfiles[0].userId;
          role = userProfiles[0].role || 'Owner';
        }
      }
      return res.status(200).json({ success: true, token, isTeamMember, isPartner, role, perms, ownerUserId: finalOwnerId, teamMemberId: finalTeamId, partnerId: finalPartnerId });
    }

    /* ──────────── REGISTER ──────────── */
    if (action === 'register') {
      if (!cleanEmail || !password) return res.status(400).json({ error: 'Email and password are required' });
      const existing = await db.query({ userCredentials: { $: { where: { email: cleanEmail } } } });
      if (existing.userCredentials?.length > 0) return res.status(400).json({ error: 'User already exists' });
      
      const hashedPassword = await bcrypt.hash(password, 10);
      const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
      await db.transact([tx.userCredentials[id()].update({ email: cleanEmail, password: hashedPassword, fullName: fullName || '', bizName: bizName || '', phone: phone || '', selectedPlan: selectedPlan || 'Trial', isVerified: false, otp: newOtp, createdAt: Date.now() })]);
      return res.status(200).json({ success: true, otp: newOtp, message: 'Registration successful. Verify OTP.' });
    }

    /* ──────────── VERIFY OTP ──────────── */
    if (action === 'verify-otp') {
      if (!cleanEmail || !otp) return res.status(400).json({ error: 'Email and OTP are required' });
      const data = await db.query({ userCredentials: { $: { where: { email: cleanEmail } } } });
      const user = data.userCredentials?.[0];
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.isVerified) return res.status(400).json({ error: 'Already verified' });
      if (user.otp !== otp) return res.status(401).json({ error: 'Invalid OTP' });
      
      await db.transact([tx.userCredentials[user.id].update({ isVerified: true, otp: null })]);
      const token = await db.auth.createToken({ email: cleanEmail });
      return res.status(200).json({ success: true, token, message: 'Verified and logged in' });
    }

    /* ──────────── ROLES ──────────── */
    if (action === 'roles') {
      if (!cleanEmail) return res.status(400).json({ error: 'Email is required' });
      const profileData = await db.query({ userProfiles: { $: { where: { email: cleanEmail } } } });
      const ownerProfile = profileData.userProfiles?.[0];
      if (ownerProfile) return res.status(200).json({ success: true, isOwner: true, isTeamMember: false, isPartner: false, role: 'Owner', perms: null, ownerUserId: ownerProfile.userId });

      const teamData = await db.query({ teamMembers: { $: { where: { email: cleanEmail } } } });
      const member = teamData.teamMembers?.[0];
      if (member) {
        const targetOwner = ownerId || member.userId;
        const { userProfiles } = await db.query({ userProfiles: { $: { where: { userId: targetOwner }, limit: 1 } } });
        const profile = userProfiles?.[0];
        if (!profile) return res.status(404).json({ error: 'Business profile not found' });
  
        const roleMatch = (profile.roles || []).find(r => r.name === member.role);
        return res.status(200).json({ success: true, isOwner: false, isTeamMember: true, isPartner: false, role: member.role, perms: roleMatch ? roleMatch.perms : {}, ownerUserId: profile.userId, teamMemberId: member.id, name: member.name });
      }

      const partnerData = await db.query({ partnerApplications: { $: { where: { email: cleanEmail, status: 'Approved' } } } });
      const partner = partnerData.partnerApplications?.[0];
      if (partner) {
        return res.status(200).json({ success: true, isOwner: false, isTeamMember: false, isPartner: true, role: partner.role, perms: null, ownerUserId: partner.userId, partnerId: partner.id, name: partner.name });
      }

      return res.status(404).json({ error: 'User not found in any business' });
    }

    /* ──────────── PASSWORD MANAGEMENT ──────────── */
    if (action === 'change-password') {
      if (!cleanEmail || !newPassword) return res.status(400).json({ error: 'Required fields missing' });
      const data = await db.query({ userCredentials: { $: { where: { email: cleanEmail } } } });
      const user = data.userCredentials?.[0];
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      if (!user) {
        if (!userId) return res.status(400).json({ error: 'userId required to create credentials' });
        await db.transact([tx.userCredentials[id()].update({ email: cleanEmail, password: hashedPassword, userId: userId, isVerified: true, createdAt: Date.now() })]);
      } else {
        await db.transact([tx.userCredentials[user.id].update({ password: hashedPassword, isVerified: true, resetCode: null, resetExpires: null })]);
      }
      return res.status(200).json({ success: true, message: 'Password updated' });
    }

    if (action === 'reset-password-request') {
      if (!cleanEmail) return res.status(400).json({ error: 'Email required' });
      const data = await db.query({ userCredentials: { $: { where: { email: cleanEmail } } } });
      const user = data.userCredentials?.[0];
      let uidToUse = user ? user.userId : null, credId = user ? user.id : null;
      let partnerExtra = {}; // Extra fields if creating credentials for a partner
      if (!user) {
        const profileData = await db.query({ userProfiles: { $: { where: { email: cleanEmail } } } });
        if (profileData.userProfiles?.[0]) {
          uidToUse = profileData.userProfiles[0].userId;
          credId = id();
        } else {
          // Also check partnerApplications for channel partners
          const partnerData = await db.query({ partnerApplications: { $: { where: { email: cleanEmail, status: 'Approved' } } } });
          const partner = partnerData.partnerApplications?.[0];
          if (!partner) return res.status(404).json({ error: 'User not found' });
          uidToUse = partner.userId;
          credId = id();
          partnerExtra = { isPartner: true, partnerId: partner.id, ownerUserId: partner.userId };
        }
      }
      const resetOtp = Math.floor(100000 + Math.random() * 900000).toString();
      await db.transact([tx.userCredentials[credId].update({ userId: uidToUse, email: cleanEmail, ...(!user ? { password: '', isVerified: true, ...partnerExtra } : {}), resetCode: resetOtp, resetExpires: Date.now() + 15 * 60 * 1000 })]);
      return res.status(200).json({ success: true, otp: resetOtp, message: 'OTP generated' });
    }

    if (action === 'reset-password-verify') {
      if (!cleanEmail || !code || !newPassword) return res.status(400).json({ error: 'Required fields missing' });
      const data = await db.query({ userCredentials: { $: { where: { email: cleanEmail } } } });
      const user = data.userCredentials?.[0];
      if (!user || user.resetCode !== code || Date.now() > user.resetExpires) return res.status(400).json({ error: 'Invalid or expired code' });
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await db.transact([tx.userCredentials[user.id].update({ password: hashedPassword, isVerified: true, resetCode: null, resetExpires: null })]);
      return res.status(200).json({ success: true, message: 'Password updated' });
    }

    if (action === 'set-team-password') {
      if (!cleanEmail || !password || !ownerUserId || !teamMemberId) return res.status(400).json({ error: 'Required fields missing' });
      const hashedPassword = await bcrypt.hash(password, 10);
      const existing = await db.query({ userCredentials: { $: { where: { email: cleanEmail } } } });
      const existingCred = existing.userCredentials?.[0];

      // If the email already has owner credentials (not a team member), don't overwrite — just update password
      if (existingCred && !existingCred.isTeamMember && !existingCred.isPartner) {
        // This is the business owner's credential — only update password, don't add team flags
        await db.transact([tx.userCredentials[existingCred.id].update({ password: hashedPassword, updatedAt: Date.now() })]);
        return res.status(200).json({ success: true, message: 'Password updated (owner account)' });
      }

      const credId = existingCred?.id || id();
      await db.transact([tx.userCredentials[credId].update({ email: cleanEmail, password: hashedPassword, ownerUserId, teamMemberId, isTeamMember: true, isVerified: true, updatedAt: Date.now(), ...(existingCred?.id ? {} : { createdAt: Date.now() }) })]);
      return res.status(200).json({ success: true, message: 'Password set' });
    }

    if (action === 'set-partner-password') {
      if (!cleanEmail || !password || !ownerUserId || !partnerId) return res.status(400).json({ error: 'Required fields missing' });
      const hashedPassword = await bcrypt.hash(password, 10);
      const existing = await db.query({ userCredentials: { $: { where: { email: cleanEmail } } } });
      const credId = existing.userCredentials?.[0]?.id || id();
      await db.transact([tx.userCredentials[credId].update({ email: cleanEmail, password: hashedPassword, ownerUserId, partnerId, isPartner: true, isVerified: true, updatedAt: Date.now(), ...(existing.userCredentials?.[0]?.id ? {} : { createdAt: Date.now() }) })]);
      return res.status(200).json({ success: true, message: 'Partner password set' });
    }

    if (action === 'delete-partner-credentials') {
      if (!cleanEmail) return res.status(400).json({ error: 'Email required' });
      const data = await db.query({ userCredentials: { $: { where: { email: cleanEmail } } } });
      const creds = data.userCredentials || [];
      const partnerCreds = creds.filter(c => c.isPartner);
      if (partnerCreds.length > 0) {
        await db.transact(partnerCreds.map(c => tx.userCredentials[c.id].delete()));
      }
      return res.status(200).json({ success: true, message: `Deleted ${partnerCreds.length} credential(s)` });
    }

    /* ──────────── ADMIN: CREATE BUSINESS ──────────── */
    if (action === 'admin-create-user') {
      if (!cleanEmail || !password) return res.status(400).json({ error: 'Email and password are required' });
      const existing = await db.query({ userCredentials: { $: { where: { email: cleanEmail } } } });
      const existingCred = existing.userCredentials?.[0];

      // Check if a profile already exists for this email (already a registered business)
      const existingProfile = await db.query({ userProfiles: { $: { where: { email: cleanEmail }, limit: 1 } } });
      if (existingProfile.userProfiles?.[0]) {
        return res.status(400).json({ error: 'A business account with this email already exists' });
      }

      // If credentials exist and are already verified, reject
      if (existingCred && existingCred.isVerified === true) {
        return res.status(400).json({ error: 'User with this email already exists' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const plan = selectedPlan || 'Trial';
      const duration = req.body.duration || 7;
      const planExpiry = Date.now() + (duration * 24 * 60 * 60 * 1000);

      // Create/update credentials first, mark as verified
      const credId = existingCred ? existingCred.id : id();
      await db.transact([
        tx.userCredentials[credId].update({
          email: cleanEmail,
          password: hashedPassword,
          fullName: fullName || '',
          bizName: bizName || '',
          phone: phone || '',
          selectedPlan: plan,
          isVerified: true,
          otp: null,
          createdAt: Date.now()
        })
      ]);

      // Create InstantDB auth user and get the real user ID
      await db.auth.createToken({ email: cleanEmail });
      let realUserId;
      try {
        const authUser = await db.auth.getUser({ email: cleanEmail });
        realUserId = authUser?.id;
      } catch (e) {
        console.warn('Could not get InstantDB auth user ID, using fallback:', e.message);
      }
      // Fallback: generate a UUID (will be corrected on first login via MainApp profile adoption)
      if (!realUserId) realUserId = id();

      const profileId = id();
      await db.transact([
        tx.userProfiles[profileId].update({
          userId: realUserId,
          email: cleanEmail,
          fullName: fullName || '',
          bizName: bizName || '',
          phone: phone || '',
          plan,
          planExpiry,
          role: 'user',
          createdAt: Date.now()
        })
      ]);

      return res.status(200).json({ success: true, message: `Business "${bizName || cleanEmail}" created successfully`, userId: realUserId, profileId });
    }

    /* ──────────── ADMIN: DELETE BUSINESS ──────────── */
    if (action === 'admin-delete-user') {
      const targetProfileId = req.body.profileId;
      const targetUserId = req.body.targetUserId;
      if (!targetProfileId || !targetUserId) return res.status(400).json({ error: 'profileId and targetUserId are required' });

      // HARD DELETE all business data — every collection with userId reference
      // (Keeps DB clean, prevents orphaned records and duplicate/performance issues)
      const tables = [
        // Core entities
        'leads', 'customers', 'invoices', 'quotations', 'tasks', 'projects',
        'appointments', 'amc', 'expenses', 'products', 'vendors', 'purchaseOrders',
        // Sales & partners
        'partnerApplications', 'partnerCommissions', 'campaigns', 'campaignTemplates',
        // Team & activity
        'teamMembers', 'attendance', 'memberStats', 'callLogs',
        'activityLogs', 'messagingLogs', 'outbox',
        // Automation
        'automations', 'automationTemplates',
        // E-commerce
        'orders', 'ecomCustomers', 'ecomSettings', 'appointmentSettings',
        // Subscriptions, coupons, files
        'subs', 'coupons', 'leadFiles'
      ];

      const txs = [];

      // Delete all business data from each table
      for (const table of tables) {
        try {
          const result = await db.query({ [table]: { $: { where: { userId: targetUserId } } } });
          const records = result[table] || [];
          records.forEach(r => txs.push(tx[table][r.id].delete()));
        } catch (e) {
          // Table might not exist, skip silently
        }
      }

      // Delete team member credentials
      const teamData = await db.query({ teamMembers: { $: { where: { userId: targetUserId } } } });
      const teamMembers = teamData.teamMembers || [];
      for (const member of teamMembers) {
        if (member.email) {
          try {
            const creds = await db.query({ userCredentials: { $: { where: { email: member.email.trim().toLowerCase() } } } });
            (creds.userCredentials || []).forEach(c => txs.push(tx.userCredentials[c.id].delete()));
          } catch (e) {}
        }
      }

      // Delete partner credentials
      const partnerData = await db.query({ partnerApplications: { $: { where: { userId: targetUserId } } } });
      const partners = partnerData.partnerApplications || [];
      for (const partner of partners) {
        if (partner.email) {
          try {
            const creds = await db.query({ userCredentials: { $: { where: { email: partner.email.trim().toLowerCase() } } } });
            (creds.userCredentials || []).forEach(c => txs.push(tx.userCredentials[c.id].delete()));
          } catch (e) {}
        }
      }

      // Delete the owner's own credentials
      const ownerEmail = req.body.ownerEmail?.trim().toLowerCase();
      if (ownerEmail) {
        try {
          const creds = await db.query({ userCredentials: { $: { where: { email: ownerEmail } } } });
          (creds.userCredentials || []).forEach(c => txs.push(tx.userCredentials[c.id].delete()));
        } catch (e) {}
      }

      // Delete the user profile itself
      txs.push(tx.userProfiles[targetProfileId].delete());

      if (txs.length > 0) {
        // Batch in chunks of 100 to avoid oversized transactions
        const batchSize = 100;
        for (let i = 0; i < txs.length; i += batchSize) {
          await db.transact(txs.slice(i, i + batchSize));
        }
      }

      return res.status(200).json({ success: true, message: `Business deleted. ${txs.length} records removed.`, deletedCount: txs.length });
    }

    /* ──────────── ADMIN: BUSINESS ANALYTICS ──────────── */
    if (action === 'business-analytics') {
      const tables = ['leads', 'customers', 'invoices', 'quotes', 'tasks', 'projects', 'activityLogs', 'teamMembers', 'partnerApplications', 'expenses', 'products', 'campaigns', 'messagingLogs', 'purchaseOrders', 'vendors', 'amcContracts', 'automationFlows'];
      
      const { userProfiles } = await db.query({ userProfiles: {} });
      const profiles = userProfiles || [];
      
      const analytics = [];
      for (const profile of profiles) {
        const uid = profile.userId;
        if (!uid) continue;
        
        const counts = {};
        let totalRecords = 0;
        
        for (const table of tables) {
          try {
            const result = await db.query({ [table]: { $: { where: { userId: uid } } } });
            const count = (result[table] || []).length;
            counts[table] = count;
            totalRecords += count;
          } catch { counts[table] = 0; }
        }
        
        // Get recent activity (last 30 days)
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        let recentActivity = 0;
        try {
          const logs = await db.query({ activityLogs: { $: { where: { userId: uid } } } });
          const allLogs = logs.activityLogs || [];
          recentActivity = allLogs.filter(l => (l.createdAt || l.ts || 0) > thirtyDaysAgo).length;
        } catch {}
        
        analytics.push({
          id: profile.id,
          userId: uid,
          email: profile.email || '',
          bizName: profile.bizName || '',
          plan: profile.plan || 'Trial',
          planExpiry: profile.planExpiry || 0,
          createdAt: profile.createdAt || 0,
          totalRecords,
          counts,
          recentActivity,
          teamSize: counts.teamMembers || 0,
        });
      }
      
      // Sort by totalRecords descending (heaviest users first)
      analytics.sort((a, b) => b.totalRecords - a.totalRecords);
      
      return res.status(200).json({ success: true, analytics });
    }

    /* ──────────── ADMIN: CLEANUP OLD LOGS ──────────── */
    if (action === 'cleanup-old-logs') {
      const months = req.body.months || 3;
      const cutoff = Date.now() - (months * 30 * 24 * 60 * 60 * 1000);
      const targetUserId = req.body.targetUserId; // optional: cleanup specific business
      
      const txs = [];
      let totalDeleted = 0;
      
      // Cleanup activity logs
      const logQuery = targetUserId 
        ? { activityLogs: { $: { where: { userId: targetUserId } } } }
        : { activityLogs: {} };
      const logData = await db.query(logQuery);
      const allLogs = logData.activityLogs || [];
      const oldLogs = allLogs.filter(l => (l.createdAt || l.ts || 0) < cutoff);
      oldLogs.forEach(l => txs.push(tx.activityLogs[l.id].delete()));
      
      // Cleanup messaging logs
      const msgQuery = targetUserId
        ? { messagingLogs: { $: { where: { userId: targetUserId } } } }
        : { messagingLogs: {} };
      try {
        const msgData = await db.query(msgQuery);
        const allMsgs = msgData.messagingLogs || [];
        const oldMsgs = allMsgs.filter(m => (m.createdAt || m.ts || 0) < cutoff);
        oldMsgs.forEach(m => txs.push(tx.messagingLogs[m.id].delete()));
      } catch {}
      
      totalDeleted = txs.length;
      
      // Batch delete in chunks of 100
      if (txs.length > 0) {
        const batchSize = 100;
        for (let i = 0; i < txs.length; i += batchSize) {
          await db.transact(txs.slice(i, i + batchSize));
        }
      }
      
      return res.status(200).json({ 
        success: true, 
        message: `Cleaned up ${totalDeleted} old records (older than ${months} months)`,
        deleted: totalDeleted,
        activityLogs: oldLogs.length,
        messagingLogs: totalDeleted - oldLogs.length
      });
    }

    /* ──────────── ADMIN: SCAN / CLEANUP ORPHANS ──────────── */
    // Finds records orphaned from prior broken deletions (wrong collection names in
    // old admin-delete-user, or pre-cascade single-row deletions).
    // Pass dryRun=true to count without deleting.
    if (action === 'scan-orphans' || action === 'cleanup-orphans') {
      const dryRun = action === 'scan-orphans';

      // All business-scoped collections — records with userId NOT in valid profiles are orphans
      const businessScoped = [
        'leads', 'customers', 'invoices', 'quotations', 'tasks', 'projects',
        'appointments', 'amc', 'expenses', 'products', 'vendors', 'purchaseOrders',
        'partnerApplications', 'partnerCommissions', 'campaigns', 'campaignTemplates',
        'teamMembers', 'attendance', 'memberStats', 'callLogs',
        'activityLogs', 'messagingLogs', 'outbox',
        'automations', 'automationTemplates',
        'orders', 'ecomCustomers', 'ecomSettings', 'appointmentSettings',
        'subs', 'coupons', 'leadFiles'
      ];

      // 1. Build set of valid userIds from userProfiles
      const { userProfiles } = await db.query({ userProfiles: {} });
      const validUserIds = new Set((userProfiles || []).map(p => p.userId).filter(Boolean));

      const txs = [];
      const report = {};

      // 2. Scan each collection for userId orphans
      for (const table of businessScoped) {
        try {
          const result = await db.query({ [table]: {} });
          const records = result[table] || [];
          const orphans = records.filter(r => r.userId && !validUserIds.has(r.userId));
          if (orphans.length > 0) {
            report[table] = orphans.length;
            if (!dryRun) orphans.forEach(r => txs.push(tx[table][r.id].delete()));
          }
        } catch { /* table may not exist */ }
      }

      // 3. Relational orphans — child records pointing to non-existent parents
      // Build id sets for each parent collection
      const buildIdSet = async (name) => {
        try {
          const r = await db.query({ [name]: {} });
          return new Set((r[name] || []).map(x => x.id));
        } catch { return new Set(); }
      };

      const leadIds = await buildIdSet('leads');
      const customerIds = await buildIdSet('customers');
      const projectIds = await buildIdSet('projects');
      const vendorIds = await buildIdSet('vendors');
      const teamMemberIds = await buildIdSet('teamMembers');
      const partnerIds = await buildIdSet('partnerApplications');

      // callLogs.leadId → leads
      try {
        const { callLogs } = await db.query({ callLogs: {} });
        const orphans = (callLogs || []).filter(c => c.leadId && !leadIds.has(c.leadId));
        if (orphans.length > 0) {
          report['callLogs (orphan leadId)'] = orphans.length;
          if (!dryRun) orphans.forEach(c => txs.push(tx.callLogs[c.id].delete()));
        }
      } catch {}

      // tasks.projectId → projects (only when projectId present)
      try {
        const { tasks } = await db.query({ tasks: {} });
        const orphans = (tasks || []).filter(t => t.projectId && !projectIds.has(t.projectId));
        if (orphans.length > 0) {
          report['tasks (orphan projectId)'] = orphans.length;
          if (!dryRun) orphans.forEach(t => txs.push(tx.tasks[t.id].delete()));
        }
      } catch {}

      // amc.customerId → customers
      try {
        const { amc } = await db.query({ amc: {} });
        const orphans = (amc || []).filter(a => a.customerId && !customerIds.has(a.customerId));
        if (orphans.length > 0) {
          report['amc (orphan customerId)'] = orphans.length;
          if (!dryRun) orphans.forEach(a => txs.push(tx.amc[a.id].delete()));
        }
      } catch {}

      // expenses.projectId → projects (only when projectId present)
      try {
        const { expenses } = await db.query({ expenses: {} });
        const orphans = (expenses || []).filter(e => e.projectId && !projectIds.has(e.projectId));
        if (orphans.length > 0) {
          report['expenses (orphan projectId)'] = orphans.length;
          if (!dryRun) orphans.forEach(e => txs.push(tx.expenses[e.id].delete()));
        }
      } catch {}

      // purchaseOrders.vendorId → vendors
      try {
        const { purchaseOrders } = await db.query({ purchaseOrders: {} });
        const orphans = (purchaseOrders || []).filter(p => p.vendorId && !vendorIds.has(p.vendorId));
        if (orphans.length > 0) {
          report['purchaseOrders (orphan vendorId)'] = orphans.length;
          if (!dryRun) orphans.forEach(p => txs.push(tx.purchaseOrders[p.id].delete()));
        }
      } catch {}

      // memberStats.memberId → teamMembers
      try {
        const { memberStats } = await db.query({ memberStats: {} });
        const orphans = (memberStats || []).filter(s => s.memberId && !teamMemberIds.has(s.memberId));
        if (orphans.length > 0) {
          report['memberStats (orphan memberId)'] = orphans.length;
          if (!dryRun) orphans.forEach(s => txs.push(tx.memberStats[s.id].delete()));
        }
      } catch {}

      // partnerCommissions.partnerId → partnerApplications
      try {
        const { partnerCommissions } = await db.query({ partnerCommissions: {} });
        const orphans = (partnerCommissions || []).filter(c => c.partnerId && !partnerIds.has(c.partnerId));
        if (orphans.length > 0) {
          report['partnerCommissions (orphan partnerId)'] = orphans.length;
          if (!dryRun) orphans.forEach(c => txs.push(tx.partnerCommissions[c.id].delete()));
        }
      } catch {}

      // userCredentials.email → must match teamMembers, userProfiles, or partnerApplications
      try {
        const { userCredentials } = await db.query({ userCredentials: {} });
        const { teamMembers } = await db.query({ teamMembers: {} });
        const { partnerApplications } = await db.query({ partnerApplications: {} });
        const validEmails = new Set();
        (userProfiles || []).forEach(p => p.email && validEmails.add(p.email.trim().toLowerCase()));
        (teamMembers || []).forEach(m => m.email && validEmails.add(m.email.trim().toLowerCase()));
        (partnerApplications || []).forEach(p => p.email && validEmails.add(p.email.trim().toLowerCase()));
        const orphans = (userCredentials || []).filter(c => c.email && !validEmails.has(c.email.trim().toLowerCase()));
        if (orphans.length > 0) {
          report['userCredentials (orphan email)'] = orphans.length;
          if (!dryRun) orphans.forEach(c => txs.push(tx.userCredentials[c.id].delete()));
        }
      } catch {}

      // attendance.staffEmail → must match a teamMember email
      try {
        const { teamMembers } = await db.query({ teamMembers: {} });
        const validStaff = new Set((teamMembers || []).map(m => (m.email || '').trim().toLowerCase()).filter(Boolean));
        const { attendance } = await db.query({ attendance: {} });
        const orphans = (attendance || []).filter(a => a.staffEmail && !validStaff.has(a.staffEmail.trim().toLowerCase()));
        if (orphans.length > 0) {
          report['attendance (orphan staffEmail)'] = orphans.length;
          if (!dryRun) orphans.forEach(a => txs.push(tx.attendance[a.id].delete()));
        }
      } catch {}

      const totalOrphans = Object.values(report).reduce((s, n) => s + n, 0);

      // 4. Execute deletion in batches of 100
      if (!dryRun && txs.length > 0) {
        const batchSize = 100;
        for (let i = 0; i < txs.length; i += batchSize) {
          await db.transact(txs.slice(i, i + batchSize));
        }
      }

      return res.status(200).json({
        success: true,
        dryRun,
        totalOrphans,
        report,
        message: dryRun
          ? `Found ${totalOrphans} orphaned records across ${Object.keys(report).length} collections`
          : `Deleted ${totalOrphans} orphaned records across ${Object.keys(report).length} collections`
      });
    }

    return res.status(405).json({ error: 'Action not allowed' });
  } catch (err) {
    console.error('Auth API error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
