# GEMINI.md

This file provides guidance to Google Gemini when working with code in this repository.

## Project Overview

**T2GCRM** is a B2B SaaS Customer Relationship Management platform designed for small-to-medium businesses. It handles leads, customers, invoices, projects, appointments, e-commerce, and automation workflows across a modular, multi-tenant architecture.

**Key Markets:** India (integration with IndiaMART, JustDial, TradeIndia, WhatsApp via Waprochat)

**⚠️ PRODUCTION APP — CRITICAL RULE:** This application is live in production with real users and real data. Before making ANY code change, verify thoroughly that it will NOT break existing functionality or corrupt/lose existing data. All changes must be backward-compatible with the current database schema and user workflows. Never run destructive operations (bulk deletes, schema migrations, collection renames) without explicit user approval. Test your logic carefully — bugs here impact real businesses.

**📝 SELF-DOCUMENTING RULE:** Whenever you make critical or important changes to the codebase (new modules, bug fixes for gotchas, architectural decisions, new integrations, schema changes, new API endpoints, permission changes, or any lesson learned from a bug), you MUST automatically update **both** `GEMINI.md` and `CLAUDE.md` with the relevant rules, notes, or documentation. Do not wait to be asked — proactively add it so future sessions never miss this knowledge.

## Tech Stack

- **Frontend:** React 18 + Vite, React Router (hash-based)
- **Backend:** Node.js + Express.js
- **Database:** InstantDB (real-time NoSQL) - both frontend and backend
- **Auth:** InstantDB magic codes + password (bcrypt hashing)
- **Email:** nodemailer (SMTP), EmailJS (frontend)
- **Styling:** Plain CSS (no external UI library)

## Git Repository

**Remote:** https://github.com/G0kulakrishnan/crm  
**Default branch:** `main`

**Always push to `main`:**
```bash
git add <files>
git commit -m "your message"
git pull origin main --rebase   # sync remote changes first
git push origin main            # then push
```

> Never push to any other branch. All changes go directly to `main`.

**MANDATORY:** Always commit and push to git after making any code changes to the app. Do not leave uncommitted work. Do not ask for permission to push — just push automatically.

## Build & Run

```bash
npm install              # Install dependencies
npm run dev             # Start Vite dev server (http://localhost:5173)
npm run build           # Production build
npm start               # Run Express server (port 3000)
```

**Development:**
- Vite with custom API simulator plugin handles `/api/*` routes
- Hot Module Reload (HMR) enabled
- Cron job (process-automations) runs every 60s in dev mode
- Logs go to console

**Production:**
- Express server serves `dist/` + API endpoints
- Designed for Vercel or similar Node.js hosting

## Project Structure

```
src/
├── components/          # React components organized by feature
│   ├── Admin/          # Admin panel, API docs, plan management
│   ├── Leads/          # Lead management (list view, kanban, import/export)
│   ├── Finance/        # Invoices, quotations, POS, billing templates
│   ├── Work/           # Teams, roles, permissions, projects, tasks, call logs
│   ├── Ecommerce/      # Store frontend, orders, checkout
│   ├── Dashboard/      # Main dashboard with KPIs
│   ├── Auth/           # Login, registration, password reset
│   ├── Layout/         # MainApp, Sidebar, Topbar, notifications
│   ├── Appointments/   # Booking and appointment system
│   ├── Business/       # Products, vendors, expenses, purchase orders
│   ├── CallLogs/       # Call tracking and logging
│   ├── Clients/        # Customer management
│   ├── Distributors/   # Channel partner management
│   ├── Marketing/      # Campaigns
│   ├── Partners/       # Partner portal
│   ├── Reports/        # Analytics and reporting
│   ├── Settings/       # Business settings
│   ├── System/         # Integrations, user manual
│   ├── Automation/     # Workflow automation builder
│   └── UI/             # Shared UI primitives (SearchableSelect, etc.)
├── hooks/              # Custom React hooks
│   ├── usePermissions.js        # Role-based permission checking
│   ├── usePlanEnforcement.js    # Plan feature gating (which modules are enabled)
│   └── useAutomationEngine.js   # Automation trigger logic
├── context/            # React Context
│   ├── AppContext.jsx  # Global UI state (activeView, sidebarExpanded)
│   └── ToastContext.jsx # Toast notification system
├── utils/              # Utilities
│   ├── helpers.js      # Date formatting, stage badges, source mappings
│   ├── constants.js    # Default values, empty templates
│   ├── activityLogger.js # Activity log helper
│   └── messaging.js    # Notification helpers (WhatsApp, email)
├── instant.js          # InstantDB client initialization
├── App.jsx             # Root component, route definitions
└── main.jsx            # React entry point

api/                    # Node.js serverless handlers
├── auth.js             # Login, register, password reset, OTP
├── data.js             # Generic CRUD operations (leads, invoices, etc)
├── finance.js          # Invoice, quotation operations
├── notify.js           # Email/WhatsApp notifications
├── call-logs.js        # Call logging and tracking
├── attendance.js       # Staff attendance
├── leads-page.js       # Server-driven paginated lead queries
├── dashboard-stats.js  # Dashboard KPI aggregation
├── lead-check-duplicate.js  # Deduplication checking
├── lead-counts.js      # Lead count queries
├── lead-lookup.js      # Individual lead lookup
├── sync-won-leads.js   # Won lead → customer auto-sync
├── _leads-cache.js     # Shared in-memory leads cache (15s TTL)
├── cron/
│   └── process-automations.js   # Email automation engine (runs every 60s)
├── webhook/
│   ├── gsheets.js      # Google Sheets integration
│   ├── indiamart.js    # IndiaMART lead webhook + pull sync
│   ├── justdial.js     # JustDial lead webhook + pull sync
│   └── tradeindia.js   # TradeIndia lead webhook + pull sync
├── ecom/
│   └── checkout.js     # E-commerce checkout and billing
└── appointments/       # Appointment booking API

server.mjs              # Express server (production)
vite.config.js          # Vite bundler config with API plugin
.env                    # Environment variables (VITE_INSTANT_APP_ID, INSTANT_ADMIN_TOKEN, PORT)
```

## Key Architecture Patterns

### Real-Time Data with InstantDB

All data queries use InstantDB subscriptions (live updates):

```javascript
const { data, isLoading } = db.useQuery({
  leads: { $: { where: { userId: ownerId } } },
  customers: { $: { where: { userId: ownerId } } }
});
```

**Multi-Tenant:** Every record has a `userId` field for data isolation. Query by userId to fetch only this business's data.

### Multi-Document Transactions

When updating multiple collections atomically:

```javascript
const txs = [
  db.tx.leads[leadId].update({ stage: 'Converted', updatedAt: Date.now() }),
  db.tx.customers[cusId].update({ leadId: leadId, createdAt: Date.now() }),
  db.tx.activityLogs[id()].update({ action: 'converted', ... })
];
await db.transact(txs);  // All-or-nothing
```

### Role-Based Permissions

The `usePermissions` hook provides permission checking:

```javascript
const perms = usePermissions(user, profile, teamMembers);
const canCreate = perms?.can('Leads', 'create') === true;  // true/false
```

Hardcoded restrictions: Team members **cannot access Admin or Settings modules**.

### Plan Enforcement

The `usePlanEnforcement` hook enforces which modules are enabled:

```javascript
const planEnf = usePlanEnforcement(profile, settings);
const leadsEnabled = planEnf?.isModuleEnabled('leads');  // true/false
const maxUsers = planEnf?.getLimit('maxUsers');  // -1 = unlimited
```

Plans are stored in `globalSettings.plans` and define:
- Which modules are enabled/disabled per plan
- Numeric limits (maxLeads, maxUsers, etc.)

## Database Collections (InstantDB)

**Auth & Users:**
- `userProfiles` - Business owner/account (plan, settings, roles, email config, disabled stages, custom fields)
- `userCredentials` - Login data (email, password hash, OTP, team/partner flags)
- `teamMembers` - Staff members (name, role, email, phone, userId)

**Core CRM:**
- `leads` - Prospects (name, email, phone, source, stage, assigned staff, custom fields, followup dates)
- `customers` - Converted leads
- `quotes` - Quotations with line items (**NOTE:** collection is `quotes`, NOT `quotations`)
- `invoices` - Billing (draft, sent, paid statuses)
- `activityLogs` - Audit trail (who did what, timestamps)

**Operations:**
- `projects` - Project management
- `tasks` - Todos and task tracking
- `appointments` - Booking system (date, time, customer, status)
- `callLogs` - Call records (direction, duration, outcome, assigned staff)
- `attendance` - Staff check-in/out

**Business:**
- `products` - Inventory (price, tax, stock)
- `vendors` - Suppliers
- `purchaseOrders` - PO records
- `expenses` - Business expenses
- `amc` - Annual Maintenance Contracts

**E-commerce:**
- `orders` - Online store orders
- `ecomCustomers` - E-commerce customer records

**Automation & System:**
- `automations` - Email workflow rules (trigger type, recipient, subject, body, active flag)
- `executedAutomations` - Deduplication cache (prevents duplicate emails)
- `globalSettings` - Branding, plans, crmDomain config
- `partnerApplications` - Partner registration (status: Pending/Approved/Rejected)
- `partnerCommissions` - Distributor/retailer commission tracking
- `outbox` - Sent message log

**IMPORTANT Collection Name Mapping (api/data.js):**
The `COLLECTION_MAP` in `api/data.js` maps module keys to actual InstantDB collection names:
- `'quotations'` → `'quotes'` (NOT `'quotations'` — this mismatch caused a delete bug before)
- `'purchase-orders'` → `'purchaseOrders'`
- `'teams'` → `'teamMembers'`
- `'call-logs'` → `'callLogs'`

## Authentication & Login Flow

1. **AuthScreen** offers two methods:
   - Password: POST `/api/auth` → email + password → validated → JWT token
   - Magic Code: `db.auth.sendMagicCode()` → code via email → `db.auth.signInWithMagicCode()`

2. **Discovery** (in MainApp.jsx):
   - If user is a team member → show MainApp with role restrictions
   - If user is a partner → show PartnerApp (distributor/retailer portal)
   - Otherwise → show MainApp as owner

3. **Permissions** checked on every action via `usePermissions` hook

4. **Team Member & Partner Authentication Gotcha**: 
   - When setting passwords for Team Members or Partners (`/api/auth`), you **MUST** explicitly set `isVerified: true` on their `userCredentials` record. 
   - Since they do not have a `userProfiles` record, the standard login flow needs to check the `teamMembers` or `partnerApplications` collections to bypass the new-account OTP verification prompt. If `isVerified` is false/undefined and they lack a `userProfiles`, they will be incorrectly blocked.

## Email Automation Engine

**Location:** `/api/cron/process-automations.js` (runs every 60 seconds)

**How it works:**
1. Finds automation rules that match trigger type (e.g., 'stage-change' on a lead)
2. Fetches template (subject, body) from `automations` collection
3. Sends via configured SMTP (per-business email config in userProfiles)
4. Records in `executedAutomations` cache to prevent duplicates

**Trigger Types:**
- `stage-change` - Lead stage updated
- `amc-expiry` - AMC expiry alert
- `new-appointment` - Appointment booked
- `ecom-order` - E-commerce order placed

**Integration:** SMTP config per business (stored in userProfiles, custom for white-label)

## Lead Integrations

### Google Sheets
- **Webhook:** `/api/webhook/gsheets`
- **Sync:** Manual "Sync Now" button in Integration panel
- **Field Mapping:** Admin configures which sheet columns → lead fields
- **Deduplication:** Phone + email matching

### IndiaMART
- **Webhook:** `/api/webhook/indiamart`
- **Sync:** Auto-webhook (POST) + manual "Sync Now" (GET with `action=sync`)
- **Known Fields:** `SENDER_NAME`, `SENDER_EMAIL`, `SENDER_MOBILE`, `SENDER_COMPANY`, `SENDER_ADDRESS`, `SENDER_CITY`, `SENDER_STATE`, `SENDER_PINCODE`, `SUBJECT`, `QUERY_MESSAGE`, `QUERY_PRODUCT_NAME`, `QUERY_TIME`, `UNIQUE_QUERY_ID`, `CALL_DURATION`, `RECEIVER_MOBILE`
- **Auth:** Single API Key (`GLUSR_CRMMOBILE_KEY`)
- **Deduplication:** Phone + email with activity log on re-submission

### JustDial
- **Webhook:** `/api/webhook/justdial`
- **Sync:** Auto-webhook (POST) + manual "Sync Now" (GET with `action=sync`)
- **Known Fields:** `leadid`, `name`, `mobile`, `phone`, `email`, `date`, `time`, `category`, `city`, `area`, `brancharea`, `company`, `pincode`
- **Auth:** Optional API Key
- **Deduplication:** Phone + email with activity log on re-submission

### TradeIndia
- **Webhook:** `/api/webhook/tradeindia`
- **Sync:** Auto-webhook (POST) + manual "Sync Now" (GET with `action=sync`)
- **Known Fields:** `sender_name`, `sender_email`, `sender_mobile`, `sender_company`, `sender_address`, `sender_city`, `sender_state`, `sender_country`, `subject`, `query_message`, `product_name`, `inquiry_date`, `inquiry_id`, `status`
- **Auth:** Three credentials: User ID, Profile ID, API Key (from TradeIndia Dashboard → Inquiries & Contacts → My Inquiry API)
- **Deduplication:** Phone + email with activity log on re-submission

All integrations:
- Configurable field mapping (Column/Fixed toggle per CRM field)
- Custom field mapping support
- Auto-match phone/email to existing leads (prevent duplicates)
- Configurable per business in Integration settings
- Store config in `userProfiles.gsheets`, `userProfiles.indiamart`, `userProfiles.justdial`, `userProfiles.tradeindia`
- Test lead button for verification
- Enable/disable toggle without deleting config

## Common Development Tasks

### Adding a New Lead Source

1. Create `/api/webhook/newsource.js` handler (POST webhook + GET pull sync, dedup by phone/email)
2. Add route in `server.mjs` and `vite.config.js`
3. Create `/src/components/System/NewsourceIntegration.jsx` component (field mapping UI)
4. Add to `src/components/System/Integrations.jsx` (add integration card + routing + all conditional checks)
5. Update `src/utils/helpers.js` DEFAULT_SOURCES array

### Adding a New Module/Feature

1. Create component in `src/components/FeatureName/`
2. Add route in `App.jsx` (hash route)
3. Add nav item in `Sidebar.jsx` with module check: `planEnf.isModuleEnabled('featureName')`
4. Add handler in `/api/` for backend operations
5. Create DB collection queries via InstantDB
6. Add permissions in admin "Roles & Permissions" (MODULES array in Teams.jsx)

### Debugging Permissions

Set `window.DEBUG_PERMS = true` in browser console to trace permission checks.

### Testing Email Automation

1. Set `VITE_BLOCK_AUTOMATIONS=false` in .env
2. Create automation rule in Settings → Automations
3. Trigger the event (e.g., change lead stage)
4. Check `/api/cron/process-automations.js` logic in server logs
5. Verify email sent via configured SMTP

## Important Implementation Notes

**Lead Count Discrepancy:**
- Sidebar badge shows total active leads (only filtered by visible stages)
- Table shows leads filtered by user assignment, dropdowns, search, and date tab
- These counts differ intentionally; both are correct for their context

**Quotation Collection Name:**
- Frontend uses `db.tx.quotes` and `db.useQuery({ quotes: ... })`
- The `COLLECTION_MAP` in `api/data.js` maps `'quotations'` → `'quotes'`
- Do NOT use `'quotations'` as the collection name — that was a bug that broke deletes

**Call Logs Connected Status:**
- API derives outcome from duration or explicit outcome field (not defaulting to "Connected")
- Web displays "Not Picked" for unanswered outgoing calls with no duration
- Duration formats as mm:ss instead of seconds

**Plan-Based Permissions:**
- Teams → Roles & Permissions modal shows only modules enabled in business plan
- Mapping: PascalCase module keys (Teams.jsx) → camelCase plan keys (AdminPanel.jsx)
- Uses `planEnforcement.isModuleEnabled()` to filter MODULES array

## File Naming Conventions

- **Components:** PascalCase (e.g., `LeadsView.jsx`, `SheetIntegration.jsx`)
- **Hooks:** camelCase with 'use' prefix (e.g., `usePermissions.js`)
- **API handlers:** kebab-case or camelCase (e.g., `process-automations.js`, `call-logs.js`)
- **Collections/DB:** camelCase (e.g., `userProfiles`, `executedAutomations`)

## Common Gotchas

1. **InstantDB WHERE clauses only filter on exact match / simple operators** — complex filters must be done in React after fetching
2. **Transaction failures are silent** — wrap `db.transact` in try/catch to catch errors
3. **Real-time updates trigger re-renders** — memoize expensive computations with `useMemo`
4. **Hash-based routing** — URLs use `/#/leads` not `/leads`; history navigation can be tricky
5. **SMTP config is per-business** — changing it affects all emails sent for that owner
6. **Plan changes take immediate effect** — all users on that plan see module changes live
7. **Disabled stages are filtered in components** — but are still queryable in DB (don't delete them)
8. **Plan module keys are case-sensitive** — Teams.jsx uses PascalCase (`Leads`), AdminPanel/usePlanEnforcement use camelCase (`leads`). Mismatch = module appears enabled/disabled incorrectly.
9. **`isModuleEnabled` is strict** — `modules[key] === true` (not `!== false`). A missing key is treated as disabled. When adding a new module to `ALL_MODULES`, re-save existing plans in Admin Panel to add the new key explicitly.
10. **`db.useQuery` with `leads: limit 10k+` will hang** — See Scale Architecture section. Always use server-driven endpoints for lead data. Never add `leads` back to a component's `db.useQuery`.
11. **Collection name `quotes` vs `quotations`** — The actual InstantDB collection is `quotes`. The API module key is `quotations`. The `COLLECTION_MAP` handles this translation. Do NOT create a new collection called `quotations`.
12. **Search functionality in Server-Paginated APIs** — Server APIs like `api/leads-page.js` do not automatically cover all entity fields. You MUST explicitly map standard fields and iterate over custom fields (e.g. `Object.values(l.custom)`) during search filtering, otherwise users cannot find records by custom attributes.
13. **Duplicate Checks via API** — When a list is server-paginated (e.g., Leads), the client-side array only contains ~25 records. You CANNOT perform deduplication checks by scanning this array. You MUST delegate deduplication checks (e.g., checking for existing phone/email) to a central backend endpoint like `/api/lead-check-duplicate` to verify uniqueness against the entire database.

## Environment Variables

```
VITE_INSTANT_APP_ID=<uuid>          # Frontend InstantDB app ID (required)
INSTANT_ADMIN_TOKEN=<token>         # Backend admin token (required)
PORT=3000                           # Express server port (optional, default 3000)
VITE_BLOCK_AUTOMATIONS=false        # Kill switch for automation engine
```

## Performance & Optimization — MANDATORY RULE

**Performance and instant page loading is a top-priority rule. Every time code is written or modified, apply these patterns. Never skip them.**

### InstantDB Query Rules
- **Always filter at query level** using `where: { userId: ownerId }` — never fetch all records and filter client-side
- **Split large queries** into core (data needed immediately to render) + deferred (data for modals/drawers)
- **Defer drawer/modal data** — activityLogs, callLogs, and other detail data must only be fetched when the drawer is open (gate with `itemId ? { ... } : {}`)
- **Always add limits** to activityLogs queries — never fetch unbounded: `limit: 200`
- **Push date filters into the query** — never fetch all logs then filter by date client-side
- **Lazy-load tab-specific data** — only subscribe when the user is on that tab
- **Never load unused collections** — audit each `db.useQuery` to ensure every collection in the query is actually rendered

### React Performance Rules
- **Always use `useMemo`** for any derived/computed value (filtered lists, counts, lookup maps, totals)
- **Build O(1) index maps** instead of repeated `.find()` / `.filter()` inside loops:
  ```javascript
  // ❌ WRONG — O(n²) inside render
  items.map(i => ({ ...i, partner: partners.find(p => p.id === i.partnerId) }))
  // ✅ CORRECT — O(1) lookup
  const partnersById = useMemo(() => Object.fromEntries(partners.map(p => [p.id, p])), [partners]);
  items.map(i => ({ ...i, partner: partnersById[i.partnerId] }))
  ```
- **Single-pass aggregation** — never do 4 separate `.filter()` calls over the same array; do it in one `useMemo` loop
- **Never put `console.log` in render paths** — strips performance from production

### Table / List Rules
- **Always paginate large lists** — default 25 rows/page; never render all records at once
- **Sticky table headers** — `th { position: sticky; top: 0; }` so headers stay visible while scrolling
- **Constrain table height to viewport** — use `maxHeight: calc(100vh - Xpx); overflowY: auto` on the scroll container

### Kanban / Board Rules
- **Kanban must stay in viewport** — use `overflow-y: hidden` on the kanban container and `height: 100%` on columns

### localStorage / Session Rules
- **Clear all `tc_*`, `leads_cache_*`, `leadView_*`, `callLogView_*` keys on logout** — prevents previous user's data from appearing
- **Never cache data without a TTL** — always store `{ data, timestamp }` and validate on read
- **Cache is keyed by `ownerId` or `user.email`** — never share cache across users

### Checklist for Every New Page or Feature
- [ ] Query is filtered by `userId: ownerId` at DB level
- [ ] Heavy/secondary data (logs, history, details) is deferred to drawer query
- [ ] All derived values are in `useMemo`
- [ ] No `.find()` or `.filter()` inside a `.map()` — use index maps instead
- [ ] List has pagination if it can exceed 25 rows
- [ ] No `console.log` in render path
- [ ] localStorage cleared on logout if caching anything

## Critical: Hard Delete Only (No Soft Deletes)

**IMPORTANT RULE:** When ANY item is deleted from the UI, it MUST be **permanently removed from the database** using `db.tx.collection[id].delete()`.

**DO NOT:**
- Use soft deletes (marking as `deleted: true` or `status: 'deleted'`)
- Leave orphaned records in the database
- Keep temporary/backup copies of deleted data
- Archive records instead of deleting them

**DO:**
- Call `db.transact(db.tx.collection[id].delete())` to hard delete
- Clean up cascading records (e.g., deleting business → delete all teamMembers, leads, invoices, automations, etc.)
- Keep database clean and memory-efficient

## CRITICAL: No Duplicate Records / No Orphans

**RULE:** Never allow duplicate records (same email, phone, userId) across collections that should be unique. When deleting from the UI, hard-delete the record AND ALL related records in the same transaction.

### High-Risk Collection Pairs (Common Source of Orphans)

- `userCredentials` ↔ `userProfiles` ↔ `partnerApplications` ↔ `teamMembers`
- `leads` ↔ `customers` (linked via `leadId`)
- `quotes` ↔ `invoices` (linked via `quotationId`)
- `partnerApplications` ↔ partner-created `leads` / `orders`

## CRITICAL: No Hardcoded Configuration Values

**NEVER hardcode configuration values like product categories, lead stages, sources, requirements, etc.** These MUST come from `userProfiles` settings (Business Settings), not from constants or code.

**Correct approach:**
- Fetch from `userProfiles.stages`, `userProfiles.sources`, `userProfiles.productCats`, etc.
- Owner customizes in Business Settings
- Dropdown/UI uses customized values with sensible defaults as fallback

```javascript
// ❌ WRONG - Hardcoded
const STAGES = ['New', 'Contacted', 'Won', 'Lost'];

// ✅ CORRECT - From settings
const stages = (profile?.stages || DEFAULT_STAGES).map(s => <option key={s}>{s}</option>);
```

## CRITICAL: Roles & Permissions — MANDATORY RULE

**Every component that performs CRUD operations MUST check permissions before allowing the action. Every page MUST be gated by plan enforcement. Never skip these checks.**

### How Permissions Work

Permissions are role-based and stored in `userProfiles.roles`. Each role defines which modules a team member can access and which actions (list, view, create, edit, delete) they can perform.

**File:** `src/hooks/usePermissions.js`

```javascript
// Every component receives `perms` as a prop from MainApp
const canCreate = perms?.can('Leads', 'create') === true;
const canEdit   = perms?.can('Leads', 'edit') === true;
const canDelete = perms?.can('Leads', 'delete') === true;

// Gate UI buttons
{canCreate && <button onClick={handleAdd}>+ Add Lead</button>}

// Gate actions inside handlers
const handleSave = async () => {
  if (editData && !canEdit) { toast('Permission denied', 'error'); return; }
  if (!editData && !canCreate) { toast('Permission denied', 'error'); return; }
  // ... proceed with save
};
```

**Special permission properties:**
- `perms?.isOwner` — true if user is the business owner
- `perms?.isAdmin` — true if user has "Admin" role
- `perms?.isManager` — true if user has management role

**Hardcoded restrictions:** Team members **cannot access Admin or Settings modules** regardless of role.

### How Plan Enforcement Works

Plans control which modules are visible and what numeric limits apply. Plans are defined in Admin Panel and stored in `globalSettings.plans`.

**File:** `src/hooks/usePlanEnforcement.js`

```javascript
// Every component receives `planEnforcement` as a prop from MainApp
const canAccessLeads = planEnforcement?.isModuleEnabled('leads');
const maxLeads = planEnforcement?.getLimit('maxLeads');  // -1 = unlimited
const withinLimit = planEnforcement?.isWithinLimit('maxLeads', currentCount);

// Gate record creation by limits
if (!planEnforcement.isWithinLimit('maxUsers', team.length)) {
  toast('Team member limit reached. Please upgrade.', 'error');
  return;
}
```

**`isModuleEnabled` is STRICT:** `modules[key] === true` (not `!== false`). A missing key = disabled. This prevents new modules from silently leaking into existing plans.

### Module Registry — The THREE Files

When adding or removing a module, you **MUST** update all three:

#### 1. Teams.jsx — Permission Module Definition (`MODULES` array)
**File:** `src/components/Work/Teams.jsx` — Uses **PascalCase** keys

Current modules:
```
Dashboard (view), Leads (LCUD), Customers (LCUD), Quotations (LCUD),
Invoices (LCUD), AMC (LCUD), Expenses (LCUD), Products (LCUD),
Vendors (LCUD), PurchaseOrders (LCUD), Campaigns (LCE), Projects (LCUD),
Tasks (LCUD), Teams (LCUD), Reports (view), Automation (LCUD),
Ecommerce (LCUD), Appointments (LCUD), Integrations (view, edit),
CallLogs (LCUD), Attendance (LCUD), MessagingLogs (list),
Distributors (LCUD), Settings (view)
```

#### 2. Teams.jsx — `MODULE_TO_PLAN_KEY` mapping
Maps PascalCase permission keys → camelCase plan keys:
```javascript
Dashboard: null,        // Always shown
Leads: 'leads',
Customers: 'customers',
Quotations: 'quotations',
Invoices: 'invoices',
AMC: 'amc',
Expenses: 'expenses',
Products: 'products',
Vendors: 'vendors',
PurchaseOrders: 'purchaseOrders',
Campaigns: 'campaigns',
Projects: 'projects',
Tasks: 'tasks',
Teams: 'teams',
Reports: 'reports',
Automation: 'automation',
Ecommerce: 'ecommerce',
Appointments: 'appointments',
Integrations: 'integrations',
CallLogs: 'callLogs',
Attendance: 'attendance',
MessagingLogs: 'messagingLogs',
Distributors: 'distributors',
Settings: null,         // Always shown
```

The Roles & Permissions modal in Teams.jsx uses `visibleModules` which **filters** MODULES to only show modules enabled in the current business plan (via `planEnforcement.isModuleEnabled(planKey)`).

#### 3. AdminPanel.jsx — Plan Module Definition (`ALL_MODULES` array)
**File:** `src/components/Admin/AdminPanel.jsx` — Uses **camelCase** keys

Current modules with limits:
```
leads (maxLeads: 10000), customers (maxCustomers: 10000), quotations,
invoices (maxInvoices: -1), pos, amc, expenses, products (maxProducts: -1),
vendors, purchaseOrders, projects (maxProjects: 10), tasks (maxTasks: 500),
teams (maxUsers: 5), campaigns, reports, automation, ecommerce,
appointments, integrations, callLogs, attendance, messagingLogs,
distributors
```

The `savePlan()` function **normalizes** all module keys to explicit `true/false` — ensures no module leaks into plans that didn't enable it.

#### 4. usePlanEnforcement.js — Sidebar View Routing (`VIEW_TO_MODULE` mapping)
**File:** `src/hooks/usePlanEnforcement.js`

Maps sidebar nav item IDs → plan module keys:
```javascript
leads → leads, customers → customers, quotations → quotations,
invoices → invoices, pos → pos, amc → amc, expenses → expenses,
products → products, vendors → vendors, purchase-orders → purchaseOrders,
projects → projects, alltasks → tasks, teams → teams,
campaigns → campaigns, reports → reports, automation → automation,
ecom-settings → ecommerce, ecom-orders → ecommerce,
appointments → appointments, integrations → integrations,
messaging-logs → messagingLogs, performance → reports,
distributors → distributors, distributor_performance → distributors,
call-logs → callLogs, attendance → attendance
```

**Always-allowed views** (never blocked by plan): `dashboard`, `userprofile`, `settings`, `admin`, `apidocs`, `manual`, `appointment-settings`

### Mandatory Rules for Every Component

1. **Every CRUD component** must accept `perms` and `planEnforcement` props
2. **Every create/edit/delete action** must check `perms?.can('ModuleName', 'action') === true`
3. **Every record creation** with a plan limit must check `planEnforcement.isWithinLimit(limitKey, currentCount)`
4. **Every page render** must be gated in Sidebar via `planEnforcement.isViewAllowed(viewId)`
5. **Hide UI buttons** when permission is denied — don't just show an error on click
6. **Show toast on denied actions** — `toast('Permission denied: cannot [action]', 'error')`

### Checklist Before Committing Any Module Change

- [ ] Module added to `Teams.jsx` MODULES array (PascalCase key + actions)
- [ ] Module added to `Teams.jsx` MODULE_TO_PLAN_KEY mapping
- [ ] Module added to `AdminPanel.jsx` ALL_MODULES array (camelCase key + limits)
- [ ] Module added to `usePlanEnforcement.js` VIEW_TO_MODULE if it has a sidebar nav item
- [ ] Case consistency: PascalCase in Teams, camelCase in Admin/Plan enforcement
- [ ] If module has limits: Added `hasLimit: true`, `limitKey`, `defaultLimit` to ALL_MODULES
- [ ] Sidebar nav item gated by `planEnforcement.isViewAllowed(viewId)`
- [ ] Component checks `perms?.can()` before every create/edit/delete
- [ ] Component checks `planEnforcement.isWithinLimit()` before record creation (if applicable)
- [ ] Default role permissions set in Teams.jsx DEFAULT_ROLES (optional)
- [ ] Existing plans re-saved in Admin Panel to include the new module key

## Scale Architecture — Server-Driven Pages (CRITICAL)

The production workspace has **11,000+ leads** and similar-scale call logs / activity logs. InstantDB's `db.useQuery` WebSocket has a `handle-receive` timeout that fails at this scale — pages that subscribe to large collections will show a spinner forever or return truncated/0 counts.

### Rule: Never subscribe to large collections with a high limit

```javascript
// ❌ WRONG — fails at 11k+ rows (returns 0, returns capped count, or hangs forever)
const { data } = db.useQuery({ leads: { $: { where: { userId: ownerId }, limit: 10000 } } });
const { data } = db.useQuery({ activityLogs: { $: { where: { userId: ownerId }, limit: 2000 } } });
const { data } = db.useQuery({ callLogs: { $: { where: { userId: ownerId }, limit: 5000 } } });

// ✅ CORRECT — server-driven endpoint, admin SDK over HTTP (no WebSocket timeout)
const res = await fetch('/api/leads-page', { method: 'POST', body: JSON.stringify({...}) });
```

**Critical sub-rule:** `db.useQuery({ collection: { $: { ..., limit: N } } })` has **no ordering guarantee** — it returns arbitrary N rows, often the oldest. So `activityLogs: { limit: 2000 }` on a busy workspace returns ancient logs that fall outside any "This Month" date filter, making every aggregate compute to 0. Always either (a) fetch via admin SDK server-side, or (b) ensure your client logic doesn't assume the returned rows are recent.

### Server-Driven Endpoints

| Endpoint | Purpose | Caller |
|---|---|---|
| `POST /api/leads-page` | Paginated lead list + date-tab counts | Web LeadsView |
| `POST /api/dashboard-stats` | KPI aggregates (totals, sources, hot leads, calendar) | Dashboard |
| `POST /api/lead-check-duplicate` | Dedup check across leads + customers | Customers, LeadsView |
| `POST /api/sync-won-leads` | Auto-sync Won-stage leads → customers collection | Customers (on mount) |
| `POST /api/team-activity` | Activity logs filtered by date range (server-side) | TeamReports |
| `GET /api/data?module=leads` | **Mobile-only.** Auto-filters by actorId | Mobile app |

All share **`api/_leads-cache.js`** (per-owner 15s TTL cache). Endpoints that fetch the full lead set use `getLeadsForOwner(ownerId)` so concurrent calls reuse one InstantDB admin query.

### Components Already Migrated

| Component | Pattern |
|---|---|
| `LeadsView.jsx` | `/api/leads-page` server-driven pagination + counts |
| `Dashboard.jsx` | `/api/dashboard-stats`, refreshes every 30s |
| `Customers.jsx` | `/api/lead-check-duplicate` + `/api/sync-won-leads` on mount |
| `Quotations.jsx`, `Invoices.jsx`, `POSBilling.jsx`, `Projects.jsx`, `AllTasks.jsx`, `AMC.jsx` | **Modal-lazy-fetch** (see below) |
| `CallLogs.jsx` | `/api/leads-page` on mount + localStorage 5-min cache |
| `Reports.jsx` | `/api/leads-page` only when leads tab is selected |
| `TeamReports.jsx` | `/api/team-activity` filtered by date range |
| `Campaigns.jsx` | `/api/leads-page` (up to 1000) on mount |

### Modal-Lazy-Fetch Pattern

Components that only need leads inside a create/edit modal (Quotations, Invoices, AMC, Projects, AllTasks, POSBilling) must lazy-fetch when the modal opens:

```javascript
const [modalLeads, setModalLeads] = useState([]);
const fetchModalLeads = async () => {
  if (modalLeads.length > 0) return;
  const r = await fetch('/api/leads-page', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ownerId, mode: 'list', pageSize: 500, tab: 'all', page: 1,
      isOwner: true, teamCanSeeAllLeads: true, boundaries: {}
    }),
  });
  setModalLeads((await r.json()).items || []);
};
// Call inside every openCreate / openEdit
```

Use `modalLeads` in the dropdown and any `leads.find(name match)` on save.

### Plan Limit Enforcement

- `usePlanEnforcement.js` — `isModuleEnabled(key)` returns `true` ONLY if `modules[key] === true` (explicit). Missing keys = disabled.
- `AdminPanel.jsx` — `savePlan` normalizes module/limit keys to `DEFAULT_*` baselines.
- **`maxLeads` default in `ALL_MODULES` is `10000`** — set to `-1` (unlimited) per plan for bulk-import customers.
- Bulk import (`performImport` in LeadsView) enforces `maxLeads`, trims to fit, asks user to confirm.

### Mobile vs Web API split — STRICT MOBILE RULE

- Web calls `/api/leads-page` and passes `isOwner` / `teamCanSeeAllLeads` / `userEmail` / `myName` explicitly.
- Mobile calls `GET /api/data?module=leads`. Auto-detects caller from `actorId`:
  - `actorId === ownerId` (or absent) → **owner → all leads**
  - `actorId` matches a `teamMembers[].id` → **team member → ALWAYS restricted to leads assigned to them (or unassigned)**
  - `userProfiles.teamCanSeeAllLeads` is **intentionally ignored** on this endpoint — admin-only sees all on mobile
- Optional `staffFilter` / `srcFilter` / `stgFilter` can further narrow but cannot expand beyond the user's allowed set.
- **Pre-fix gotcha:** raw `/api/data` was returning all leads to every caller. If you add a new module to `/api/data`, decide whether it needs the same assignee-only filtering (tasks, callLogs, appointments often do).

### Symptoms of the Scale Bug (for diagnosis)

- Dashboard shows "Total Leads: 0" or "9999" — subscription truncated
- Page stuck on "Loading..." spinner — subscription handle-receive timeout
- Date tab counts unchanged when staff filter changes — `staffFilter` not being sent server-side
- Team Performance metrics show 0 across all date filters — activity logs subscription returning arbitrary rows outside the date window
- Mobile shows all leads instead of "my" leads — `/api/data?module=leads` filter bypassed

## Call Logs Integrity (CRITICAL)

Call logs sync from the Android app via `/api/call-logs` POST batch.

### Server-side dedup fingerprint

Every POST builds a fingerprint per entry and skips duplicates:

```
fingerprint = `${last10digits(phone)}|${direction}|${floor(createdAt/60000)}|${duration||0}|${staffEmail||''}`
```

Minute-bucketing intentional — Android can re-send the same call with ms-level drift. Dedup runs against existing rows AND within the batch.

### Duration is the only honest signal of "Connected"

The Android sync sometimes sends `outcome: 'Connected'` on zero-duration calls. Codebase trusts duration alone:

- Server `deriveOutcome`: `duration > 0` ⇒ `Connected`; `duration === 0` + `outcome === 'Connected'` ⇒ overridden to `No Answer`
- UI row badge: `isConnected = duration > 0`
- Team summary: `connected = filter(l => duration > 0)`, `notPicked = filter(l => duration === 0)`
- Rollup grouping: `isUnpickedCall = (l) => !l.duration || Number(l.duration) === 0`

If new code depends on connectedness, use duration — not `outcome === 'Connected'`.

### UI rollup grouping

Consecutive unpicked calls (duration 0) to the same `phone + direction + staffEmail` within 24 hours collapse into one synthetic row with `attemptCount`, `firstAttemptAt`, `lastAttemptAt`, `groupedIds`. Connected calls always render individually. Delete on grouped row deletes all `groupedIds`.

### No manual cleanup buttons — one-shot migrations

Data-quality bugs in production are fixed via **one-shot migration scripts** (e.g. `_migrate-call-logs.mjs` using `@instantdb/admin`), run locally with prod `.env`, then deleted. Commit only the prevent-recurrence guard (fingerprint dedup, hardened `deriveOutcome`). Don't ship one-time fixes as admin-panel buttons users have to find and click.

## Known Limitations

- No formal test suite (manual QA)
- No TypeScript (plain JavaScript)
- CSS-only styling (no Tailwind or CSS-in-JS framework)
- Chunk loading errors reload page once (lazy boundary handler)
- No service worker or offline support

## Useful Commands for Debugging

```bash
# Check permissions in console
window.DEBUG_PERMS = true;

# Check localStorage
Object.keys(localStorage).forEach(k => console.log(k, localStorage.getItem(k)));

# Monitor cron job
npm run dev  # Tail console for "process-automations" logs
```

## Related Files to Read First

- **Understanding the app:** `src/App.jsx` (routes), `src/components/Layout/MainApp.jsx` (main UI)
- **Understanding auth:** `api/auth.js`, `src/components/Auth/`
- **Understanding data flow:** `src/components/Leads/LeadsView.jsx` (example of full CRUD)
- **Understanding automation:** `/api/cron/process-automations.js`
- **Understanding integrations:** `src/components/System/Integrations.jsx` + webhook handlers
- **Understanding permissions:** `src/hooks/usePermissions.js`, `src/hooks/usePlanEnforcement.js`

---

**This codebase is production-ready for SaaS deployment on Vercel, AWS Lambda, or similar serverless/Node.js hosting. It demonstrates enterprise patterns: multi-tenancy, real-time sync, role-based access, email automation, and modular feature architecture.**
