import React, { useState } from 'react';
import db from '../../instant';


const API_LIST = [
  { 
    group: 'Authentication', 
    path: '/api/auth', 
    method: 'POST', 
    desc: 'Unified authentication gateway for user identity and security.',
    actions: [
      { name: 'Login', method: 'POST', body: { action: 'login', email: 'user@example.com', password: 'yourpassword' }, notes: 'Store ownerUserId and teamMemberId from the response — you will pass them on every subsequent API call:\n  • ownerId  = ownerUserId  (always required)\n  • actorId  = teamMemberId for team members, OR ownerUserId for owners (teamMemberId will be null for owners)', resp: { success: true, token: '...', isTeamMember: false, isPartner: false, role: 'Owner', perms: null, ownerUserId: 'WORKSPACE_ID', teamMemberId: null, partnerId: null }, errors: [{ status: 400, error: 'Email and password are required' }, { status: 401, error: 'Invalid email or password' }, { status: 403, error: 'Email verification pending' }] },
      { name: 'Register', method: 'POST', body: { action: 'register', email: 'user@example.com', password: 'yourpassword', fullName: 'John Doe', bizName: 'Acme Corp', phone: '9876543210', selectedPlan: 'Trial' }, resp: { success: true, otp: '123456', message: 'Registration successful. Verify OTP.' }, errors: [{ status: 400, error: 'Email and password are required' }, { status: 400, error: 'User already exists' }] },
      { name: 'Verify OTP', method: 'POST', body: { action: 'verify-otp', email: 'user@example.com', otp: '123456' }, resp: { success: true, token: '...', message: 'Verified and logged in' }, errors: [{ status: 400, error: 'Email and OTP are required' }, { status: 400, error: 'Already verified' }, { status: 401, error: 'Invalid OTP' }, { status: 404, error: 'User not found' }] },
      { name: 'Roles Lookup', method: 'POST', body: { action: 'roles', email: 'user@example.com' }, resp: { success: true, isOwner: true, isTeamMember: false, isPartner: false, role: 'Owner', perms: null, ownerUserId: 'WORKSPACE_ID' }, errors: [{ status: 400, error: 'Email is required' }, { status: 404, error: 'User not found in any business' }, { status: 404, error: 'Business profile not found' }] },
      { name: 'Change Password', method: 'POST', body: { action: 'change-password', email: 'user@example.com', newPassword: 'newSecurePass123' }, resp: { success: true, message: 'Password updated' }, errors: [{ status: 400, error: 'Required fields missing' }, { status: 400, error: 'userId required to create credentials' }] },
      { name: 'Reset Password (Request OTP)', method: 'POST', body: { action: 'reset-password-request', email: 'user@example.com' }, resp: { success: true, otp: '654321', message: 'OTP generated' }, errors: [{ status: 400, error: 'Email required' }, { status: 404, error: 'User not found' }] },
      { name: 'Reset Password (Verify & Set)', method: 'POST', body: { action: 'reset-password-verify', email: 'user@example.com', code: '654321', newPassword: 'newSecurePass' }, resp: { success: true, message: 'Password updated' }, errors: [{ status: 400, error: 'Required fields missing' }, { status: 400, error: 'Invalid or expired code' }] },
      { name: 'Set Team Member Password', method: 'POST', body: { action: 'set-team-password', email: 'member@team.com', password: 'teamPass123', ownerUserId: 'WORKSPACE_ID', teamMemberId: 'MEMBER_ID' }, resp: { success: true, message: 'Password set' }, errors: [{ status: 400, error: 'Required fields missing' }] },
      { name: 'Set Partner Password', method: 'POST', body: { action: 'set-partner-password', email: 'partner@biz.com', password: 'partnerPass123', ownerUserId: 'WORKSPACE_ID', partnerId: 'PARTNER_ID' }, resp: { success: true, message: 'Partner password set' }, errors: [{ status: 400, error: 'Required fields missing' }] }
    ]
  },
  {
    group: 'Admin Management',
    path: '/api/auth',
    method: 'POST',
    desc: 'Superadmin-only endpoints for business account lifecycle management.',
    actions: [
      { 
        name: 'Create Business (Admin)', method: 'POST', 
        body: { action: 'admin-create-user', email: 'newbiz@example.com', password: 'securePass123', fullName: 'Jane Smith', bizName: 'Smith Corp', phone: '9876543210', selectedPlan: 'Premium', duration: 30 }, 
        resp: { success: true, message: 'Business "Smith Corp" created successfully', userId: 'NEW_USER_ID', profileId: 'NEW_PROFILE_ID' },
        errors: [{ status: 400, error: 'Email and password are required' }, { status: 400, error: 'User with this email already exists' }]
      },
      { 
        name: 'Delete Business (Admin)', method: 'POST', 
        desc: '⚠️ IRREVERSIBLE — Cascading delete of ALL data: leads, customers, invoices, tasks, projects, team/partner credentials, expenses, products, campaigns, automation flows, etc.',
        body: { action: 'admin-delete-user', profileId: 'PROFILE_ID', targetUserId: 'USER_ID', ownerEmail: 'owner@example.com' }, 
        resp: { success: true, message: 'Business deleted. 142 records removed.', deletedCount: 142 },
        errors: [{ status: 400, error: 'profileId and targetUserId are required' }]
      }
    ]
  },
  {
    group: 'Leads (CRM)',
    path: '/api/data/leads',
    method: 'ALL',
    desc: 'Manage potential clients and inquiries.',
    actions: [
      { name: 'Create Lead (POST)', method: 'POST', body: { ownerId: 'WORKSPACE_ID', actorId: 'USER_ID', module: 'leads', name: 'John Smith', email: 'john@example.com', phone: '9876543210', source: 'Website', stage: 'New', logText: 'Lead captured via app' }, resp: { success: true, id: '12345...', message: 'Record created successfully' }, errors: [{ status: 400, error: 'Invalid or missing module' }, { status: 400, error: 'ownerId is required to identify the workspace context' }] },
      { name: 'List Leads (GET)', method: 'GET', query: 'module=leads&ownerId=WORKSPACE_ID&actorId=CALLER_ID', notes: 'actorId identifies the caller and drives Team-Permissions visibility.\n  • Owner: pass actorId = ownerUserId (or omit actorId) — returns ALL leads in the workspace.\n  • Team member: pass actorId = teamMemberId — returns only leads that member is allowed to see based on Settings → Team Permissions (assigned-only, with or without unassigned).\n\nWhere do these IDs come from? The /api/auth Login response returns both ownerUserId and teamMemberId — store them after login and reuse for every API call.', resp: { success: true, data: [{ id: '123', name: 'John Smith', stage: 'New' }], count: 25 }, errors: [{ status: 400, error: 'Invalid or missing module' }, { status: 400, error: 'ownerId is required' }] },
      { name: 'Update Lead (PATCH)', method: 'PATCH', body: { module: 'leads', id: 'LEAD_ID', ownerId: 'WORKSPACE_ID', stage: 'Contacted', logText: 'Called client' }, resp: { success: true, message: 'Record updated successfully' }, errors: [{ status: 400, error: 'Record ID is required for updates' }] },
      { name: 'Delete Lead (DELETE)', method: 'DELETE', body: { module: 'leads', id: 'LEAD_ID', ownerId: 'WORKSPACE_ID' }, resp: { success: true, message: 'Record deleted successfully' }, errors: [{ status: 400, error: 'Record ID is required for deletion' }] }
    ]
  },
  {
    group: 'Customers',
    path: '/api/data/customers',
    method: 'ALL',
    desc: 'Manage your verified clients and their details.',
    actions: [
      { name: 'Create Customer (POST)', method: 'POST', body: { module: 'customers', ownerId: '...', actorId: '...', name: 'Acme Corp', email: 'billing@acme.com', phone: '9988776655', address: '123 Street', state: 'Tamil Nadu', country: 'India', gstin: '22AAAAA0000A1Z5' }, resp: { success: true, id: '...', message: 'Record created successfully' }, errors: [{ status: 400, error: 'Invalid or missing module' }, { status: 400, error: 'ownerId is required' }] },
      { name: 'List Customers (GET)', method: 'GET', query: 'module=customers&ownerId=...', resp: { success: true, data: [{ id: '...', name: 'Acme Corp' }] }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'Update Customer (PATCH)', method: 'PATCH', body: { module: 'customers', id: 'CUST_ID', ownerId: '...', email: 'new@acme.com' }, resp: { success: true, message: 'Record updated successfully' }, errors: [{ status: 400, error: 'Record ID is required for updates' }] },
      { name: 'Delete Customer (DELETE)', method: 'DELETE', body: { module: 'customers', id: 'CUST_ID', ownerId: '...' }, resp: { success: true, message: 'Record deleted successfully' }, errors: [{ status: 400, error: 'Record ID is required for deletion' }] }
    ]
  },
  {
    group: 'Projects',
    path: '/api/data/projects',
    method: 'ALL',
    desc: 'Manage ongoing work and client projects. Creating a project auto-converts matching leads to Won.',
    actions: [
      { name: 'Create Project (POST)', method: 'POST', body: { module: 'projects', ownerId: '...', actorId: '...', name: 'Website Redesign', client: 'Acme Corp', status: 'In Progress', budget: 50000, deadline: '2026-12-31' }, resp: { success: true, id: '...', message: 'Record created successfully' }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'List Projects (GET)', method: 'GET', query: 'module=projects&ownerId=...', resp: { success: true, data: [{ id: '...', name: 'Website Redesign', status: 'In Progress' }] }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'Update Project (PATCH)', method: 'PATCH', body: { module: 'projects', id: 'PROJ_ID', ownerId: '...', status: 'Completed' }, resp: { success: true, message: 'Record updated successfully' }, errors: [{ status: 400, error: 'Record ID is required for updates' }] },
      { name: 'Delete Project (DELETE)', method: 'DELETE', desc: 'Also deletes all child tasks under this project.', body: { module: 'projects', id: 'PROJ_ID', ownerId: '...' }, resp: { success: true, message: 'Record deleted successfully' }, errors: [{ status: 400, error: 'Record ID is required for deletion' }] }
    ]
  },
  {
    group: 'Tasks',
    path: '/api/data/tasks',
    method: 'ALL',
    desc: 'Manage individual tasks. Auto-assigns sequential task numbers (T-101, T-102...).',
    actions: [
      { name: 'Create Task (POST)', method: 'POST', body: { module: 'tasks', ownerId: '...', actorId: '...', title: 'Design Homepage', projectId: 'PROJ_ID', priority: 'High', status: 'Pending', assignedTo: 'Designer' }, resp: { success: true, id: '...', message: 'Record created successfully' }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'List Tasks (GET)', method: 'GET', query: 'module=tasks&ownerId=...', resp: { success: true, data: [{ id: '...', title: 'Design Homepage', status: 'Pending', taskNumber: 101 }] }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'Update Task (PATCH)', method: 'PATCH', desc: 'Setting status to "Completed" auto-increments team member stats.', body: { module: 'tasks', id: 'TASK_ID', ownerId: '...', status: 'Completed' }, resp: { success: true, message: 'Record updated successfully' }, errors: [{ status: 400, error: 'Record ID is required for updates' }] },
      { name: 'Delete Task (DELETE)', method: 'DELETE', body: { module: 'tasks', id: 'TASK_ID', ownerId: '...' }, resp: { success: true, message: 'Record deleted successfully' }, errors: [{ status: 400, error: 'Record ID is required for deletion' }] }
    ]
  },
  {
    group: 'Quotations',
    path: '/api/data/quotations',
    method: 'ALL',
    desc: 'Generate and manage sales quotes.',
    actions: [
      { name: 'Create Quote (POST)', method: 'POST', body: { module: 'quotations', ownerId: '...', no: 'QUOTE/2026/001', client: 'Acme Corp', date: '2026-03-22', validUntil: '2026-04-05', status: 'Created', items: [{ name: 'Web Dev', qty: 1, rate: 10000, taxRate: 18 }], sub: 10000, taxAmt: 1800, total: 11800 }, resp: { success: true, id: '...', message: 'Record created successfully' }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'List Quotes (GET)', method: 'GET', query: 'module=quotations&ownerId=...', resp: { success: true, data: [{ id: '...', no: 'QUOTE/2026/001' }] }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'Update Quote (PATCH)', method: 'PATCH', body: { module: 'quotations', id: 'QUOTE_ID', ownerId: '...', status: 'Sent' }, resp: { success: true, message: 'Record updated successfully' }, errors: [{ status: 400, error: 'Record ID is required for updates' }] },
      { name: 'Delete Quote (DELETE)', method: 'DELETE', body: { module: 'quotations', id: 'QUOTE_ID', ownerId: '...' }, resp: { success: true, message: 'Record deleted successfully' }, errors: [{ status: 400, error: 'Record ID is required for deletion' }] }
    ]
  },
  {
    group: 'Invoices',
    path: '/api/data/invoices',
    method: 'ALL',
    desc: 'Generate, manage, and track tax invoices.',
    actions: [
      { name: 'Create Invoice (POST)', method: 'POST', body: { module: 'invoices', ownerId: '...', no: 'INV/2026/001', client: 'Acme Corp', date: '2026-03-22', dueDate: '2026-04-05', status: 'Draft', items: [{ name: 'Web Dev', qty: 1, rate: 10000, taxRate: 18 }], sub: 10000, taxAmt: 1800, total: 11800 }, resp: { success: true, id: '...', message: 'Record created successfully' }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'List Invoices (GET)', method: 'GET', query: 'module=invoices&ownerId=...', resp: { success: true, data: [{ id: '...', no: 'INV/2026/001', total: 11800 }] }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'Update Invoice & Payment (PATCH)', method: 'PATCH', body: { module: 'invoices', id: 'INV_ID', ownerId: '...', status: 'Partially Paid', payments: [{ amount: 5000, date: 1711234567890 }] }, resp: { success: true, message: 'Record updated successfully' }, errors: [{ status: 400, error: 'Record ID is required for updates' }] },
      { name: 'Delete Invoice (DELETE)', method: 'DELETE', body: { module: 'invoices', id: 'INV_ID', ownerId: '...' }, resp: { success: true, message: 'Record deleted successfully' }, errors: [{ status: 400, error: 'Record ID is required for deletion' }] }
    ]
  },
  {
    group: 'AMC Contracts',
    path: '/api/data',
    method: 'ALL',
    desc: 'Annual Maintenance Contracts management. Module key: amc',
    actions: [
      { name: 'Create AMC (POST)', method: 'POST', body: { module: 'amc', ownerId: '...', actorId: '...', client: 'Acme Corp', plan: 'Premium Support', amount: 25000, startDate: '2026-04-01', endDate: '2027-03-31', billingCycle: 'Yearly', status: 'Active' }, resp: { success: true, id: '...', message: 'Record created successfully' }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'List AMC (GET)', method: 'GET', query: 'module=amc&ownerId=...', resp: { success: true, data: [{ id: '...', client: 'Acme Corp', status: 'Active' }] }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'Update AMC (PATCH)', method: 'PATCH', body: { module: 'amc', id: 'AMC_ID', ownerId: '...', status: 'Expired' }, resp: { success: true, message: 'Record updated successfully' }, errors: [{ status: 400, error: 'Record ID is required for updates' }] },
      { name: 'Delete AMC (DELETE)', method: 'DELETE', body: { module: 'amc', id: 'AMC_ID', ownerId: '...' }, resp: { success: true, message: 'Record deleted successfully' }, errors: [{ status: 400, error: 'Record ID is required for deletion' }] }
    ]
  },
  {
    group: 'Expenses',
    path: '/api/data',
    method: 'ALL',
    desc: 'Track business expenses and costs. Module key: expenses',
    actions: [
      { name: 'Create Expense (POST)', method: 'POST', body: { module: 'expenses', ownerId: '...', actorId: '...', title: 'Office Supplies', amount: 5000, category: 'Operations', date: '2026-03-22' }, resp: { success: true, id: '...', message: 'Record created successfully' }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'List Expenses (GET)', method: 'GET', query: 'module=expenses&ownerId=...', resp: { success: true, data: [{ id: '...', title: 'Office Supplies', amount: 5000 }] }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'Update Expense (PATCH)', method: 'PATCH', body: { module: 'expenses', id: 'EXP_ID', ownerId: '...', amount: 5500 }, resp: { success: true, message: 'Record updated successfully' }, errors: [{ status: 400, error: 'Record ID is required for updates' }] },
      { name: 'Delete Expense (DELETE)', method: 'DELETE', body: { module: 'expenses', id: 'EXP_ID', ownerId: '...' }, resp: { success: true, message: 'Record deleted successfully' }, errors: [{ status: 400, error: 'Record ID is required for deletion' }] }
    ]
  },
  {
    group: 'Products / Inventory',
    path: '/api/data',
    method: 'ALL',
    desc: 'Manage product catalog and stock tracking. Module key: products',
    actions: [
      { name: 'Create Product (POST)', method: 'POST', body: { module: 'products', ownerId: '...', actorId: '...', name: 'Wireless Mouse', code: 'WM-001', rate: 500, tax: 18, stock: 100, trackStock: true, unit: 'Nos' }, resp: { success: true, id: '...', message: 'Record created successfully' }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'List Products (GET)', method: 'GET', query: 'module=products&ownerId=...', resp: { success: true, data: [{ id: '...', name: 'Wireless Mouse', stock: 100, rate: 500 }] }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'Update Product (PATCH)', method: 'PATCH', body: { module: 'products', id: 'PROD_ID', ownerId: '...', stock: 85 }, resp: { success: true, message: 'Record updated successfully' }, errors: [{ status: 400, error: 'Record ID is required for updates' }] },
      { name: 'Delete Product (DELETE)', method: 'DELETE', body: { module: 'products', id: 'PROD_ID', ownerId: '...' }, resp: { success: true, message: 'Record deleted successfully' }, errors: [{ status: 400, error: 'Record ID is required for deletion' }] }
    ]
  },
  {
    group: 'Vendors',
    path: '/api/data',
    method: 'ALL',
    desc: 'Manage vendor/supplier contacts. Module key: vendors',
    actions: [
      { name: 'Create Vendor (POST)', method: 'POST', body: { module: 'vendors', ownerId: '...', actorId: '...', name: 'Supplier Inc', email: 'sales@supplier.com', phone: '9988776655' }, resp: { success: true, id: '...', message: 'Record created successfully' }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'List Vendors (GET)', method: 'GET', query: 'module=vendors&ownerId=...', resp: { success: true, data: [{ id: '...', name: 'Supplier Inc' }] }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'Update Vendor (PATCH)', method: 'PATCH', body: { module: 'vendors', id: 'V_ID', ownerId: '...', name: 'Updated Supplier' }, resp: { success: true, message: 'Record updated successfully' }, errors: [{ status: 400, error: 'Record ID is required for updates' }] },
      { name: 'Delete Vendor (DELETE)', method: 'DELETE', body: { module: 'vendors', id: 'V_ID', ownerId: '...' }, resp: { success: true, message: 'Record deleted successfully' }, errors: [{ status: 400, error: 'Record ID is required for deletion' }] }
    ]
  },
  {
    group: 'Purchase Orders',
    path: '/api/data',
    method: 'ALL',
    desc: 'Create and manage vendor purchase orders. Module key: purchase-orders',
    actions: [
      { name: 'Create PO (POST)', method: 'POST', body: { module: 'purchase-orders', ownerId: '...', actorId: '...', vendor: 'Supplier Inc', items: [{ name: 'Raw Material', qty: 50, rate: 200 }], total: 10000, status: 'Draft' }, resp: { success: true, id: '...', message: 'Record created successfully' }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'List POs (GET)', method: 'GET', query: 'module=purchase-orders&ownerId=...', resp: { success: true, data: [{ id: '...', vendor: 'Supplier Inc', total: 10000 }] }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'Update PO (PATCH)', method: 'PATCH', body: { module: 'purchase-orders', id: 'PO_ID', ownerId: '...', status: 'Ordered' }, resp: { success: true, message: 'Record updated successfully' }, errors: [{ status: 400, error: 'Record ID is required for updates' }] },
      { name: 'Delete PO (DELETE)', method: 'DELETE', body: { module: 'purchase-orders', id: 'PO_ID', ownerId: '...' }, resp: { success: true, message: 'Record deleted successfully' }, errors: [{ status: 400, error: 'Record ID is required for deletion' }] }
    ]
  },
  {
    group: 'Team Members',
    path: '/api/data',
    method: 'ALL',
    desc: 'Manage team member accounts and roles. Module key: teams',
    actions: [
      { name: 'Create Member (POST)', method: 'POST', body: { module: 'teams', ownerId: '...', actorId: '...', name: 'John Staff', email: 'john@company.com', role: 'Sales Rep' }, resp: { success: true, id: '...', message: 'Record created successfully' }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'List Members (GET)', method: 'GET', query: 'module=teams&ownerId=...', resp: { success: true, data: [{ id: '...', name: 'John Staff', role: 'Sales Rep' }] }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'Update Member (PATCH)', method: 'PATCH', body: { module: 'teams', id: 'MEMBER_ID', ownerId: '...', role: 'Manager' }, resp: { success: true, message: 'Record updated successfully' }, errors: [{ status: 400, error: 'Record ID is required for updates' }] },
      { name: 'Delete Member (DELETE)', method: 'DELETE', body: { module: 'teams', id: 'MEMBER_ID', ownerId: '...' }, resp: { success: true, message: 'Record deleted successfully' }, errors: [{ status: 400, error: 'Record ID is required for deletion' }] }
    ]
  },
  {
    group: 'Activity Logs',
    path: '/api/data',
    method: 'ALL',
    desc: 'Read and manage system activity logs. Module key: logs',
    actions: [
      { name: 'List Logs (GET)', method: 'GET', query: 'module=logs&ownerId=...', resp: { success: true, data: [{ id: '...', entityType: 'lead', text: 'Stage changed to Contacted', createdAt: 1711234567890 }] }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'Delete Log (DELETE)', method: 'DELETE', body: { module: 'logs', id: 'LOG_ID', ownerId: '...' }, resp: { success: true, message: 'Record deleted successfully' }, errors: [{ status: 400, error: 'Record ID is required for deletion' }] }
    ]
  },
  {
    group: 'Subscriptions',
    path: '/api/data',
    method: 'ALL',
    desc: 'Manage recurring billing subscriptions. Module key: subs',
    actions: [
      { name: 'Create Sub (POST)', method: 'POST', body: { module: 'subs', ownerId: '...', actorId: '...', client: 'Acme Corp', plan: 'Monthly Plan', amount: 999, cycle: 'Monthly', status: 'Active' }, resp: { success: true, id: '...', message: 'Record created successfully' }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'List Subs (GET)', method: 'GET', query: 'module=subs&ownerId=...', resp: { success: true, data: [{ id: '...', client: 'Acme Corp', status: 'Active' }] }, errors: [{ status: 400, error: 'ownerId is required' }] }
    ]
  },
  {
    group: 'Ecommerce Orders',
    path: '/api/data',
    method: 'ALL',
    desc: 'View and manage e-commerce orders placed through storefront. Module key: orders',
    actions: [
      { name: 'List Orders (GET)', method: 'GET', query: 'module=orders&ownerId=...', resp: { success: true, data: [{ id: '...', customerName: 'Jane Doe', total: 1500, status: 'Pending' }] }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'Update Order (PATCH)', method: 'PATCH', body: { module: 'orders', id: 'ORDER_ID', ownerId: '...', status: 'Shipped' }, resp: { success: true, message: 'Record updated successfully' }, errors: [{ status: 400, error: 'Record ID is required for updates' }] }
    ]
  },
  {
    group: 'Ecom Settings & Customers',
    path: '/api/data',
    method: 'ALL',
    desc: 'Manage storefront settings and storefront-specific customer data. Module keys: ecomSettings, ecomCustomers',
    actions: [
      { name: 'Get Ecom Settings (GET)', method: 'GET', query: 'module=ecomSettings&ownerId=...', resp: { success: true, data: [{ id: '...', storeName: 'My Store', slug: 'my-store' }] }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'Get Ecom Customers (GET)', method: 'GET', query: 'module=ecomCustomers&ownerId=...', resp: { success: true, data: [{ id: '...', name: 'Jane Doe' }] }, errors: [{ status: 400, error: 'ownerId is required' }] }
    ]
  },
  {
    group: 'Appointments (Internal)',
    path: '/api/data',
    method: 'ALL',
    desc: 'Manage appointments from admin side. Module keys: appointments, appointmentSettings',
    actions: [
      { name: 'List Appointments (GET)', method: 'GET', query: 'module=appointments&ownerId=...', resp: { success: true, data: [{ id: '...', customerName: 'Alice', service: 'Consultation', date: '2026-03-25', time: '10:00 AM', status: 'Pending' }] }, errors: [{ status: 400, error: 'ownerId is required' }] },
      { name: 'Update Appointment (PATCH)', method: 'PATCH', body: { module: 'appointments', id: 'APT_ID', ownerId: '...', status: 'Completed' }, resp: { success: true, message: 'Record updated successfully' }, errors: [{ status: 400, error: 'Record ID is required for updates' }] },
      { name: 'Get Appointment Settings (GET)', method: 'GET', query: 'module=appointmentSettings&ownerId=...', resp: { success: true, data: [{ id: '...', maxPerSlot: 3, workingHours: { start: '09:00', end: '18:00' } }] }, errors: [{ status: 400, error: 'ownerId is required' }] }
    ]
  },
  {
    group: 'Member Stats',
    path: '/api/data',
    method: 'GET',
    desc: 'Daily activity statistics per team member. Module key: memberStats. Auto-updated by the system.',
    actions: [
      { name: 'List Stats (GET)', method: 'GET', query: 'module=memberStats&ownerId=...', resp: { success: true, data: [{ id: '...', memberId: 'M_ID', date: '2026-03-25', leadsWorked: 5, tasksCompleted: 3, otherWorks: 2 }] }, errors: [{ status: 400, error: 'ownerId is required' }] }
    ]
  },
  { 
    group: 'POS Billing', 
    path: '/api/finance', 
    method: 'POST', 
    desc: 'Retail checkout processing. Auto-deducts stock and converts matching leads to Won.',
    actions: [
      { name: 'Generate Retail Bill', method: 'POST', body: { action: 'generate-bill', cart: [{ id: 'PROD_ID', name: 'Wireless Mouse', qty: 2, rate: 500, tax: 18 }], customer: { id: 'CUST_ID', name: 'Walk-in', phone: '9000000000' }, payMode: 'UPI', userId: 'WORKSPACE_ID', actorId: 'USER_ID' }, resp: { success: true, invoice: { id: '...', no: 'POS-123456', client: 'Walk-in', total: 1180, status: 'Paid' } }, errors: [{ status: 400, error: 'Missing checkout data' }, { status: 400, error: 'Insufficient stock for Wireless Mouse' }, { status: 405, error: 'Action not allowed' }, { status: 500, error: 'Missing InstantDB credentials' }] }
    ]
  },
  { 
    group: 'Messaging', 
    path: '/api/notify', 
    method: 'POST', 
    desc: 'Send transactional emails or WhatsApp messages. Includes server-side deduplication.',
    actions: [
      { name: 'Send Email', method: 'POST', body: { type: 'email', to: 'client@example.com', subject: 'Invoice #123', body: 'Hi, find attached...', ownerId: 'WORKSPACE_ID', processedKey: 'unique-dedup-key' }, resp: { success: true, messageId: '<msg-id@smtp>' }, errors: [{ status: 400, error: 'Missing required fields' }, { status: 400, error: 'SMTP not configured' }, { status: 500, error: 'SMTP connection / auth error' }] },
      { name: 'Send WhatsApp (Template)', method: 'POST', body: { type: 'whatsapp', to: '919876543210', templateId: '329129', variables: [{ field: 'body', index: 1, value: 'John' }], ownerId: 'WORKSPACE_ID', processedKey: 'unique-dedup-key' }, resp: { success: true, messageId: 'wamid.xxx' }, errors: [{ status: 400, error: 'WhatsApp not configured' }, { status: 400, error: 'Template ID required for WhatsApp' }, { status: 400, error: 'Waprochat template fail' }] },
      { name: 'Deduplicated (Skipped)', method: 'POST', desc: 'Returned when a duplicate message is detected within the same minute window.', body: { type: 'email', to: '...', body: '...', ownerId: '...', processedKey: 'same-key-again' }, resp: { success: true, skipped: true, message: 'Duplicate blocked by server-side guard' }, errors: [] }
    ]
  },
  {
    group: 'Ecommerce Checkout (Public)',
    path: '/api/ecom/checkout',
    method: 'POST',
    desc: 'Public endpoint for store checkouts. Auto-creates lead + invoice.',
    actions: [
      { 
        name: 'Submit Order', method: 'POST', 
        body: { ownerId: 'WORKSPACE_ID', ecomName: 'store-slug', customer: { name: 'Jane Doe', email: 'jane@example.com', phone: '9876543210', address: '123 Main St' }, items: [{ name: 'Product A', qty: 1, rate: 100 }], total: 100 }, 
        resp: { success: true, orderId: '...', invoiceId: '...', invoiceNo: 'ECOM/2026/1234' },
        errors: [{ status: 400, error: 'Missing required fields: ownerId, customer, items' }, { status: 400, error: 'Mail ID or phone number mismatch with existing record' }, { status: 405, error: 'Method not allowed' }, { status: 500, error: 'Checkout failed' }]
      }
    ]
  },
  {
    group: 'Appointment Booking (Public)',
    path: '/api/appointments/book',
    method: 'POST',
    desc: 'Public booking endpoint. Respects maxPerSlot from settings. Auto-creates lead.',
    actions: [
      { 
        name: 'Book Slot', method: 'POST', 
        body: { ownerId: 'WORKSPACE_ID', slug: 'store-slug', service: 'Hair Cut', date: '2026-03-25', time: '10:00 AM', customer: { name: 'Alice Smith', email: 'alice@example.com', phone: '9988776655' } }, 
        resp: { success: true, appointmentId: '...' },
        errors: [{ status: 400, error: 'Missing required fields: ownerId, date, time, customer.name, customer.phone' }, { status: 400, error: 'Mail ID or phone number mismatch with existing record' }, { status: 409, error: 'This time slot is fully booked (max N per slot)' }, { status: 405, error: 'Method not allowed' }, { status: 500, error: 'Booking failed' }]
      }
    ]
  },
  {
    group: 'Google Sheets Webhook',
    path: '/api/webhook/gsheets',
    method: 'POST',
    desc: 'Receives lead data from Google Sheets via Apps Script automation.',
    actions: [
      { 
        name: 'Receive Lead', method: 'POST', 
        body: { userId: 'WORKSPACE_ID', actorId: 'USER_ID', type: 'lead', data: ['John Doe', 'john@example.com', '9876543210', 'Website', 'New'] }, 
        resp: { success: true, message: 'Lead processed and added to CRM', leadId: '...' },
        errors: [{ status: 400, error: 'Invalid payload structure' }, { status: 400, error: 'No active Google Sheets mapping found for this user' }, { status: 400, error: 'Incomplete integration configuration' }, { status: 404, error: 'User profile not found' }, { status: 405, error: 'Method Not Allowed' }, { status: 500, error: 'Internal server error processing webhook' }]
      },
      { 
        name: 'Duplicate Lead (Auto-logged)', method: 'POST', 
        desc: 'When a lead with matching email/phone already exists, an activity log is added instead of creating a duplicate.',
        body: { userId: '...', data: ['...', 'existing@mail.com', '...'] }, 
        resp: { success: true, message: 'Lead already exists, added log', leadId: 'existing-lead-id' },
        errors: []
      }
    ]
  }
];

export default function ApiDocs({ ownerId }) {
  const [apiSearch, setApiSearch] = useState('');
  const { data } = db.useQuery({ 
    userProfiles: { $: { where: { userId: ownerId } } },
    globalSettings: {}
  });
  const profile = data?.userProfiles?.[0];
  const gStats = data?.globalSettings?.[0];
  const baseUrl = gStats?.crmDomain || profile?.website || window.location.origin;

  const getActionPath = (groupPath, action) => {
    if (groupPath.startsWith('/api/data/')) {
       if (action.method === 'GET') return `${groupPath}/list`;
       if (action.method === 'POST') return `${groupPath}/create`;
       if (action.method === 'PATCH') return `${groupPath}/update`;
       if (action.method === 'DELETE') return `${groupPath}/delete`;
    }
    return groupPath;
  };



  const filtered = API_LIST.filter(g => 
    g.group.toLowerCase().includes(apiSearch.toLowerCase()) || 
    g.desc.toLowerCase().includes(apiSearch.toLowerCase()) ||
    g.actions.some(a => a.name.toLowerCase().includes(apiSearch.toLowerCase()))
  );

  return (
    <div className="reports-view api-docs-view">
      <style>{`
        @media print {
          .no-print, .btn, .btn-sm, .sidebar, .topbar, .sh button, .btn-icon { display: none !important; }
          body, .app, .main, .content, .api-docs-view { background: #fff !important; padding: 0 !important; margin: 0 !important; width: 100% !important; overflow: visible !important; }
          .sh { padding: 0 !important; margin-bottom: 20px !important; border: none !important; box-shadow: none !important; }
          .tw { border: none !important; box-shadow: none !important; background: #fff !important; }
          .tw-head { border-bottom: 2px solid #eee !important; padding: 10px 0 !important; }
          pre { white-space: pre-wrap !important; word-break: break-all !important; border: 1px solid #ddd !important; }
          .badge { border: 1px solid #ddd !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          h2, h3, h4 { color: #000 !important; }
          a { text-decoration: none !important; color: #000 !important; }
          /* Ensure column layout in print */
          .api-docs-view .tw pre { font-size: 10px !important; }
        }
        .api-docs-view .btn-icon { opacity: 0.6; transition: opacity 0.2s; }
        .api-docs-view .btn-icon:hover { opacity: 1; }
      `}</style>
      <div className="sh">
        <div>
          <h2>API Documentation</h2>
          <div className="sub">Technical reference for CRM backend integration</div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => {
          const blob = new Blob([JSON.stringify(API_LIST, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'crm_full_api_docs.json';
          a.click();
          URL.revokeObjectURL(url);
        }}>
          📥 Export Full Specs (JSON)
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
          📄 Download as PDF
        </button>
      </div>

      <div style={{ marginBottom: 30, padding: '0 20px' }}>
        <div className="tw" style={{ padding: 24, background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 12 }}>
          <h3 style={{ marginBottom: 15, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>🛠️</span> Developer System Overview
          </h3>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div>
              <h4 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>1. Real-time Infrastructure (InstantDB SDK)</h4>
              <p style={{ fontSize: 13, lineHeight: '1.6', color: 'var(--text-soft)' }}>
                For real-time features like chat or live dashboard updates, use the <strong>InstantDB SDK</strong> in Flutter instead of raw HTTP.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', padding: '8px 12px', borderRadius: 8, border: '1.5px solid var(--border)', marginTop: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>App ID:</span>
                <code style={{ fontSize: 12, flex: 1, letterSpacing: 1 }}>19c2...cfd</code>
                <button className="btn-icon" onClick={() => {
                  navigator.clipboard.writeText('19c240f7-1ba0-486a-95b4-adb651f63cfd');
                  alert('App ID Copied!');
                }}>📋</button>
              </div>
            </div>

            <div>
              <h4 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>2. Authentication Workflow</h4>
              <p style={{ fontSize: 13, lineHeight: '1.6', color: 'var(--text-soft)' }}>
                Login returns a <strong>token</strong> (for SDK) and an <strong>ownerUserId</strong> (Workspace Identifier). 
                Save these locally.
              </p>
              <ul style={{ fontSize: 12, marginTop: 8, paddingLeft: 18, color: 'var(--text-soft)' }}>
                <li>Every data request <strong>MUST</strong> include <code>ownerId</code> (set this to <code>ownerUserId</code> from login).</li>
                <li><code>actorId</code> should be the logged-in user's own ID.</li>
              </ul>
            </div>

            <div>
              <h4 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>3. File & Image Handling</h4>
              <p style={{ fontSize: 13, lineHeight: '1.6', color: 'var(--text-soft)' }}>
                This backend persists images (logos, QR codes) as **Base64 encoded strings**. 
                Convert mobile gallery images to Base64 before sending in `POST/PATCH` payloads.
              </p>
            </div>

            <div>
              <h4 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>4. Standardized API Endpoints</h4>
              <p style={{ fontSize: 13, lineHeight: '1.6', color: 'var(--text-soft)' }}>
                All CRUD operations now follow an explicit path-based structure for maximum clarity:
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                 <span className="badge bg-green">/list</span>
                 <span className="badge bg-blue">/create</span>
                 <span className="badge bg-yellow">/update</span>
                 <span className="badge bg-red">/delete</span>
              </div>
            </div>
          </div>
        </div>
      </div>


      <div className="tw">
        <div className="tw-head">
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <h3>Interactive Developer Reference</h3>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>Comprehensive request/response schemas for all consolidated handlers.</div>
          </div>
          <div className="sw">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input 
              className="si" 
              style={{ minWidth: 220 }}
              placeholder="Search actions or handlers..." 
              value={apiSearch}
              onChange={e => setApiSearch(e.target.value)}
            />
          </div>
        </div>
        
        <div style={{ padding: '0 20px 20px' }}>
          {filtered.map((group, gIdx) => (
            <div key={gIdx} style={{ marginBottom: 40 }}>
              <div style={{ marginBottom: 16, borderLeft: '4px solid var(--accent)', paddingLeft: 12 }}>
                <h3 style={{ margin: 0, fontSize: 18 }}>{group.group}</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                  <code style={{ background: 'var(--bg-soft)', color: 'var(--accent)', fontWeight: 700, padding: '2px 8px', borderRadius: 4, fontSize: 13 }}>{group.path}</code>
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>{group.desc}</span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {group.actions.map((action, aIdx) => (
                  <div key={aIdx} style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
                    <div style={{ padding: '12px 18px', background: 'var(--bg-soft)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 7px', borderRadius: 4, background: action.method === 'GET' ? '#10b981' : action.method === 'DELETE' ? '#ef4444' : action.method === 'PATCH' ? '#f59e0b' : '#6366f1', color: '#fff' }}>
                          {action.method || group.method}
                        </span>
                        <strong style={{ fontSize: 14 }}>{action.name.replace(/\(.*\)/, '').trim()}</strong>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <code style={{ fontSize: 11, background: '#fff', padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', color: 'var(--muted)' }}>
                          {baseUrl.replace(/^https?:\/\//, '')}{getActionPath(group.path, action)}{action.query ? `?${action.query}` : ''}
                        </code>
                        <button className="btn-icon" style={{ padding: '2px 6px', fontSize: 10 }} onClick={() => {
                          const fullUrl = `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}${getActionPath(group.path, action)}${action.query ? `?${action.query}` : ''}`;
                          navigator.clipboard.writeText(fullUrl);
                          alert('URL Copied!');
                        }}>📋</button>
                      </div>
                    </div>
                    
                    <div style={{ padding: 18 }}>
                      {action.desc && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, fontStyle: 'italic' }}>{action.desc}</div>}
                      {action.notes && (
                        <div style={{ fontSize: 12, color: '#0c4a6e', background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: 8, padding: '10px 12px', marginBottom: 12, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                          <strong style={{ color: '#075985' }}>ℹ️ Behaviour</strong>
                          <div style={{ marginTop: 4 }}>{action.notes}</div>
                        </div>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, width: '100%' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                            Payload / Parameters
                            <span style={{ fontWeight: 400, textTransform: 'none' }}>{action.query ? 'Query Strings' : 'JSON Body'}</span>
                          </div>
                          <pre style={{ margin: 0, fontSize: 12, background: '#f8fafc', color: '#334155', padding: '14px', borderRadius: 8, border: '1px solid #e2e8f0', minHeight: 120, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                            {action.query || JSON.stringify(action.body, null, 2)}
                          </pre>
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#0369a1', textTransform: 'uppercase', marginBottom: 8 }}>✅ Success Response</div>
                          <pre style={{ margin: 0, fontSize: 12, background: '#e0f2fe', color: '#0369a1', padding: '14px', borderRadius: 8, border: '1px solid #bae6fd', minHeight: 120, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                            {JSON.stringify(action.resp, null, 2)}
                          </pre>
                          {action.errors && action.errors.length > 0 && (
                            <div style={{ marginTop: 12 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', marginBottom: 8 }}>❌ Error Responses</div>
                              <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, overflow: 'hidden' }}>
                                {action.errors.map((err, eIdx) => (
                                  <div key={eIdx} style={{ padding: '8px 12px', borderBottom: eIdx < action.errors.length - 1 ? '1px solid #fca5a5' : 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: '#ef4444', color: '#fff', flexShrink: 0 }}>{err.status}</span>
                                    <code style={{ fontSize: 11, color: '#991b1b', wordBreak: 'break-word' }}>{err.error}</code>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

