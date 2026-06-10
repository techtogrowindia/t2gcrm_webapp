# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- Hosted on a **Contabo VPS** (Node.js + Express, **not** Vercel/serverless)
- **Production URL:** https://crm.t2gcrm.in
- **Dev/staging URL:** https://dev.t2gcrm.in
- Server logs are on the VPS — there is no Vercel dashboard; SSH to the box (or ask the user for log access) when you need to inspect runtime output

**Deploying changes to the VPS:**
- **API-only change** (`api/*.js`, `server.mjs`): `git pull` + restart Node (`pm2 restart all` or the systemd service). **No `npm run build` needed** — these run server-side directly.
- **Frontend change** (`src/**`): `git pull` + **`npm run build`** (rebuilds `dist/`) + restart. The browser/UI won't reflect `src/` edits until `dist/` is rebuilt.
- **Diagnosing prod without log access:** you can `curl` the live endpoints directly (e.g. `curl -s "https://crm.t2gcrm.in/api/data?module=leads&ownerId=..."`) to inspect real responses. A temporary `_debug` field in a JSON response is a fast way to surface server-side state when VPS logs aren't reachable — remove it after.

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
- `callLogSyncState` - Per-device sync checkpoint (deviceId, ownerId, lastSyncedAt, totalSynced) — prevents duplicate floods on app reinstall/upgrade
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

## Authentication & Login Flow

1. **AuthScreen** offers two methods:
   - Password: POST `/api/auth` -> email + password -> validated -> JWT token
   - Magic Code: `db.auth.sendMagicCode()` -> code via email -> `db.auth.signInWithMagicCode()`

2. **Discovery** (in MainApp.jsx):
   - If user is a team member -> show MainApp with role restrictions
   - If user is a partner -> show PartnerApp (distributor/retailer portal)
   - Otherwise -> show MainApp as owner

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

## WhatsApp Auto-Notification System (Waprochat)

**Architecture:** Three-layer system — Settings UI → `src/utils/messaging.js` → `api/notify.js` → Waprochat API.

### How it works end-to-end

1. **Template setup** (Settings → WhatsApp Templates): Owner creates a template matching a Waprochat template. The body uses `#variableName#` placeholders — the **exact same names** as the variable names defined in the Waprochat portal. Template is saved in `userProfiles.whatsappTemplates[]`.

2. **Event fires** (e.g. invoice saved, lead created): The component calls `fireAutoNotifications(eventType, data, profile, ownerId)` from `src/utils/messaging.js`.

3. **`fireAutoNotifications`** (`src/utils/messaging.js`):
   - Finds matching templates (`autoTrigger === eventType && autoEnabled === true`)
   - Determines recipient phone from `recipientType`: `'client'` → `data.phone`; `'owner'` → `profile.waNotifPhone || profile.phone`; `'assignee'` → `data.assigneePhone` (the assigned staff member's phone, resolved from `teamMembers` by matching the lead's `assign` against name/email at the call site)
   - Extracts `#variable#` names from body (two regexes: normal vars + `#+Nday#` date tokens)
   - **Excludes `#phone#`** from variables — it is the `phone_number` recipient field, NOT a template variable
   - Resolves built-in date vars (`#today#`, `#tomorrow#`, `#+Nday#`) at send time
   - Resolves other vars by looking up `data[varName]`
   - Calls `POST /api/notify` with `{ type:'whatsapp', to, templateId, variables, processedKey, ownerId }`

4. **`api/notify.js`**:
   - Deduplicates via `executedAutomations` collection (minute-window, keyed by `processedKey`)
   - Fetches `waApiToken` + `waPhoneId` from `userProfiles` (never from client)
   - Sends to Waprochat: `POST https://portal.waprochat.in/api/v1/whatsapp/send/template`
   - Form fields: `apiToken`, `phone_number_id`, `template_id`, `phone_number`, `templateVariable-<name>-<index>=<value>`
   - **`v.name` is used for the field key** (not `v.field` — that was a bug, fixed)
   - Logs result to `outbox` collection (server-side only — do NOT also log client-side)

### CRITICAL RULES — never break these

1. **Variable names must exactly match Waprochat template variable names.** The CRM sends `templateVariable-<name>-<index>=<value>` where `<name>` is taken directly from the `#variableName#` in the template body. If the Waprochat template defines a variable named `name`, the body must use `#name#` — not `#client#`.

2. **`#phone#` is always excluded from the variables array.** It is sent as the `phone_number` top-level field (the recipient). Including it in `templateVariable-phone-N` too would duplicate it and break the send. If a user needs the phone number inside the message body, they use `#leadphoneno#` or `#clientphoneno#` instead.

3. **Server (`api/notify.js`) is the sole outbox logger for WhatsApp.** `fireAutoNotifications` does NOT call `logToOutbox`. Logging in both places causes duplicate rows in Messaging Logs.

4. **`v.name` not `v.field` in notify.js.** Variables are built with `{ index, name, value }`. The Waprochat field key must use `v.name || v.field` — using `v.field` alone gives `undefined` → every variable posts as `templateVariable-undefined-N` and Waprochat ignores them.

5. **`processedKey` must be stable and unique per send.** Format: `wa-auto-<ownerId>-<eventType>-<templateId>-<phone>-<entityId>`. This prevents duplicates within the minute window.

### userProfiles fields for WhatsApp

| Field | Purpose |
|---|---|
| `waApiToken` | Waprochat API token |
| `waPhoneId` | Waprochat phone number ID |
| `whatsappTemplates` | Array of template objects (see schema below) |
| `waNotifPhone` | Owner's dedicated WhatsApp number for `recipientType:'owner'` templates. Takes priority over `bizPhone`. Include country code (e.g. `919876543210`). |

### Template object schema (`userProfiles.whatsappTemplates[]`)

```js
{
  id: string,           // internal UUID
  name: string,         // display name (e.g. "Invoice Notification")
  templateId: string,   // Waprochat template ID (e.g. "388925")
  body: string,         // message body with #variable# placeholders
  variables: [{ index, name, raw }],  // auto-extracted from body on save
  autoTrigger: string,  // event key (see table below) or '' for manual-only
  autoEnabled: boolean, // whether auto-send is active
  recipientType: string, // 'client' (default) | 'owner' | 'assignee' (assigned staff member's phone — needs data.assigneePhone)
  customCurl: string,   // optional: user-edited curl override (bypasses auto-generation)
}
```

### Auto-trigger events + available variables

| Event key | When fires | Key data variables |
|---|---|---|
| `lead_created` | New lead saved | `#lead#`, `#client#`, `#phone#`*, `#leadphoneno#`, `#clientphoneno#`, `#stage#`, `#source#`, `#requirement#`, `#email#`, `#date#`, `#bizName#` |
| `lead_stage_changed` | Lead stage edited | `#lead#`, `#client#`, `#fromstage#`, `#tostage#`, `#stage#`, `#phone#`*, `#leadphoneno#`, `#assignee#`, `#date#` |
| `lead_assigned` | Lead assigned/reassigned | `#lead#`, `#client#`, `#assignee#`, `#phone#`*, `#leadphoneno#`, `#stage#`, `#date#` |
| `customer_created` | Lead moves to Won | `#lead#`, `#client#`, `#phone#`*, `#leadphoneno#`, `#stage#`, `#date#` |
| `quotation_created` | New quotation saved | `#client#`, `#phone#`*, `#clientphoneno#`, `#quoteno#`, `#amount#`, `#validuntil#`, `#date#`, `#bizName#` |
| `invoice_created` | New invoice saved | `#client#`, `#phone#`*, `#clientphoneno#`, `#invoiceno#`, `#amount#`, `#date#`, `#bizName#` |
| `payment_received` | Payment logged on invoice | `#client#`, `#phone#`*, `#clientphoneno#`, `#invoiceno#`, `#amount#`, `#date#`, `#bizName#` |
| `appointment_booked` | Booking form submitted | `#client#`, `#phone#`*, `#clientphoneno#`, `#service#`, `#date#`, `#apptDate#`, `#apptTime#`, `#bizName#` |
| `task_assigned` | New task with assignee | `#assignee#`, `#task#`, `#client#`, `#duedate#`, `#priority#`, `#date#` — **phone = staff member's phone** |
| `lead_followup` | Daily cron, N days before follow-up date | `#lead#`, `#client#`, `#phone#`*, `#leadphoneno#`, `#stage#`, `#assignee#`, `#followupdate#`, `#daysLeft#`, `#date#` |
| `amc_expiry` | AMC saved with endDate ≤ 30 days away; also daily cron N days before | `#client#`, `#phone#`*, `#clientphoneno#`, `#contractNo#`, `#endDate#`, `#daysLeft#`, `#amount#`, `#plan#`, `#date#` |
| `order_placed` | E-commerce checkout | `#client#`, `#phone#`*, `#clientphoneno#`, `#orderId#`, `#orderAmount#`, `#orderStatus#`, `#date#`, `#bizName#` |

*`#phone#` is the **recipient** field — excluded from template variables. Use `#leadphoneno#` or `#clientphoneno#` to include the phone number inside the message body.

### Built-in date variables (resolved at send time, DD/MM/YYYY)

| Variable | Value |
|---|---|
| `#today#` | Today's date |
| `#tomorrow#` | Tomorrow's date |
| `#+1day#` | Today + 1 day |
| `#+Nday#` | Today + N days (any positive integer, e.g. `#+30day#`) |

### In-app Variable Guide (WAVariableGuide.jsx)

**File:** `src/components/Settings/WAVariableGuide.jsx`

This is the single source of truth for all `#variable#` placeholders. It renders as a modal in **Settings → WhatsApp Templates** (opened via the "📖 Variable Guide" button below the Insert Variable buttons).

**SELF-DOCUMENTING RULE:** Whenever a new `#variable#` is added to any `fireAutoNotifications()` call site OR to the date resolver in `messaging.js`, it **MUST** be added to the `MODULES` array (or `DATE_VARS` array) in `WAVariableGuide.jsx` with:
- `name`: the `#variable#` placeholder
- `desc`: plain-English description
- `example`: a realistic example value

If a new event module is added, add a new entry to the `MODULES` array with `id`, `label`, `trigger`, `how`, `recipient`, `variables[]`, and an `example` template body.

### How to add a new trigger event (checklist)

1. **`src/utils/messaging.js`** — add `{ value: 'event_key', label: 'Human Label' }` to `AUTO_TRIGGER_EVENTS`.
2. **Component** where the action happens — call `fireAutoNotifications('event_key', data, profile, ownerId).catch(() => {})` after the DB write succeeds. Import `{ fireAutoNotifications }` from `'../../utils/messaging'`.
3. **`data` object** — include all variables a user might put in their template body. Follow naming conventions: `client` for customer name, `phone` for recipient, `leadphoneno`/`clientphoneno` for phone-in-body, `date` for ISO date, `bizName` for business name, `ownerPhone` for `waNotifPhone || profile.phone`, `entityId` for a stable dedup identifier.
4. **`src/components/Settings/Settings.jsx`** — add Insert Variable buttons for the new variables in the `WhatsApp Templates` tab.
5. **This doc** — add the event row to the table above.

### Call sites (where `fireAutoNotifications` is called)

| File | Event(s) |
|---|---|
| `src/components/Leads/LeadsView.jsx` | `lead_created`, `lead_stage_changed`, `lead_assigned`, `customer_created` |
| `src/components/Finance/Invoices.jsx` | `invoice_created`, `payment_received` |
| `src/components/Finance/Quotations.jsx` | `quotation_created` |
| `src/components/Work/AllTasks.jsx` | `task_assigned` |
| `src/components/Appointments/BookingPage.jsx` | `appointment_booked` |
| `src/components/Ecommerce/StorePage.jsx` | `order_placed` |
| `src/components/Clients/AMC.jsx` | `amc_expiry` (fires on save when endDate ≤ 30 days) |
| `api/cron/process-wa-followup.js` | `lead_followup` (daily cron, N days before followup date) |

### Known bugs (fixed — never revert)

- **`v.field` undefined bug**: `notify.js` built `templateVariable-${v.field}-${v.index}` but variables are built with `v.name`. Fixed to `v.name || v.field`. Reverting this means ALL template variables silently post as `templateVariable-undefined-N` and Waprochat ignores them — the template body renders with raw `#client#`, `#date#` etc.
- **Double outbox log**: `sendWhatsApp` in `messaging.js` had a client-side `logToOutbox` AND `notify.js` had a server-side write → 2 log rows per send. Fixed: `fireAutoNotifications` calls `/api/notify` directly, server is the sole logger.
- **`#phone#` as template variable**: if body contained `#phone#`, it was sent as both `templateVariable-phone-N` AND `phone_number`. Fixed: `#phone#` always excluded from the variables array.

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
2. **Add import + route in `server.mjs`** — `vite.config.js` resolves dynamically so dev works without this, but **production returns 404 until `server.mjs` is updated**. This is the most common gotcha when adding a new webhook. Always add both the `import` line and the `app.all(...)` line.
3. Create `/src/components/System/NewsourceIntegration.jsx` component (field mapping UI)
4. Add to `src/components/System/Integrations.jsx` (add integration card + routing + all conditional checks)
5. Update `src/utils/helpers.js` DEFAULT_SOURCES array

> **Real bug (May 2026):** TradeIndia webhook (`/api/webhook/tradeindia`) existed in `api/` and worked in dev but returned 404 in production for months because `server.mjs` was never updated. Always verify the route is in `server.mjs` after creating any new API file.

### Adding a New Module/Feature

1. Create component in `src/components/FeatureName/`
2. Add route in `App.jsx` (hash route)
3. Add nav item in `Sidebar.jsx` with module check: `planEnf.isModuleEnabled('featureName')`
4. Add handler in `/api/` for backend operations
5. Create DB collection queries via InstantDB
6. Add permissions in admin "Roles & Permissions" (MODULES array in Teams.jsx)

### Debugging Permissions

Set `window.DEBUG_PERMS = true` in browser console to trace permission checks. Logs will show which permissions are granted/denied and why.

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

**Duplicate Profile Bug (Fixed):**
- When admin creates account, now retrieves real auth userId from InstantDB before creating profile
- MainApp adopts mismatched profiles via email-based secondary lookup
- See `api/auth.js` admin-create-user action and MainApp.jsx profile adoption logic

**Call Logs Connected Status (Fixed):**
- API now derives outcome from duration or explicit outcome field (not defaulting to "Connected")
- Web displays "Not Picked" for unanswered outgoing calls with no duration
- Duration formats as mm:ss instead of seconds
- Team summary includes "Not Picked" count

**Plan-Based Permissions (Fixed):**
- Teams → Roles & Permissions modal now shows only modules enabled in business plan
- Mapping: PascalCase module keys (Teams.jsx) → camelCase plan keys (AdminPanel.jsx)
- Uses `planEnforcement.isModuleEnabled()` to filter MODULES array

## File Naming Conventions

- **Components:** PascalCase (e.g., LeadsView.jsx, SheetIntegration.jsx)
- **Hooks:** camelCase with 'use' prefix (e.g., usePermissions.js)
- **API handlers:** kebab-case or camelCase (e.g., process-automations.js, call-logs.js)
- **Collections/DB:** camelCase (e.g., userProfiles, executedAutomations)

## Common Gotchas

1. **InstantDB WHERE clauses only filter on exact match / simple operators** — complex filters must be done in React after fetching
2. **Transaction failures are silent** — wrap db.transact in try/catch to catch errors
3. **Real-time updates trigger re-renders** — memoize expensive computations with useMemo
4. **Hash-based routing** — URLs use `/#/leads` not `/leads`; history navigation can be tricky
5. **SMTP config is per-business** — changing it affects all emails sent for that owner
6. **Plan changes take immediate effect** — all users on that plan see module changes live
7. **Disabled stages are filtered in components** — but are still queryable in DB (don't delete them)
8. **Plan module keys are case-sensitive** — Teams.jsx uses PascalCase (`Leads`), AdminPanel/usePlanEnforcement use camelCase (`leads`). Mismatch = module appears enabled/disabled incorrectly.
9. **`isModuleEnabled` is strict** — `modules[key] === true` (not `!== false`). A missing key is treated as disabled. When adding a new module to `ALL_MODULES`, re-save existing plans in Admin Panel to add the new key explicitly.
10. **`db.useQuery` with `leads: limit 10k+` will hang** — See Scale Architecture section. Always use server-driven endpoints for lead data. Never add `leads` back to a component's `db.useQuery`.
11. **Search functionality in Server-Paginated APIs** - Server APIs like `api/leads-page.js` do not automatically cover all entity fields. You MUST explicitly map standard fields and iterate over custom fields (e.g. `Object.values(l.custom)`) during search filtering, otherwise users cannot find records by custom attributes.
12. **Duplicate Checks via API** - When a list is server-paginated (e.g., Leads), the client-side array only contains ~25 records. You CANNOT perform deduplication checks by scanning this array. You MUST delegate deduplication checks (e.g., checking for existing phone/email) to a central backend endpoint like `/api/lead-check-duplicate` to verify uniqueness against the entire database.

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
- **Split large queries** into core (data needed immediately to render) + deferred (data for modals/drawers):
  ```javascript
  // Core — loads immediately, renders page
  const { data: coreData } = db.useQuery({ leads: { $: { where: { userId: ownerId } } }, userProfiles: { $: { where: { userId: ownerId } } } });
  // Deferred — loads after, non-blocking
  const { data: deferredData } = db.useQuery({ activityLogs: { $: { where: { userId: ownerId } } }, callLogs: { $: { where: { userId: ownerId } } } });
  ```
- **Defer drawer/modal data** — activityLogs, callLogs, and other detail data must only be fetched when the drawer is open (gate with `itemId ? { ... } : {}`):
  ```javascript
  const { data: drawerData } = db.useQuery(selectedId ? { activityLogs: { $: { where: { entityId: selectedId } } } } : {});
  ```
- **Always add limits** to activityLogs queries — never fetch unbounded: `limit: 200`
- **Push date filters into the query** — never fetch all logs then filter by date client-side
- **Lazy-load tab-specific data** — only subscribe when the user is on that tab:
  ```javascript
  const { data: tabData } = db.useQuery(tab === 'team' ? { teamMembers: { ... } } : {});
  ```
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
- **Constrain table height to viewport** — use `maxHeight: calc(100vh - Xpx); overflowY: auto` on the scroll container so the horizontal scrollbar is always visible without scrolling the page

### Kanban / Board Rules
- **Kanban must stay in viewport** — use `overflow-y: hidden` on the kanban container and `height: 100%` on columns so the board never causes page scroll; cards scroll within their column

### localStorage / Session Rules
- **Clear all `tc_*`, `leads_cache_*`, `leadView_*`, `callLogView_*` keys on logout** — prevents previous user's data from appearing for the next login
- **Never cache data without a TTL** — always store `{ data, timestamp }` and validate on read
- **Cache is keyed by `ownerId` or `user.email`** — never share cache across users

### Checklist for Every New Page or Feature
When writing any new component that fetches data, verify:
- [ ] Query is filtered by `userId: ownerId` at DB level
- [ ] Heavy/secondary data (logs, history, details) is deferred to drawer query
- [ ] All derived values are in `useMemo`
- [ ] No `.find()` or `.filter()` inside a `.map()` — use index maps instead
- [ ] List has pagination if it can exceed 25 rows
- [ ] No `console.log` in render path
- [ ] localStorage cleared on logout if caching anything

## Critical: Hard Delete Only (No Soft Deletes)

**IMPORTANT RULE:** When ANY item is deleted from the UI (business, lead, customer, invoice, team member, etc.), it MUST be **permanently removed from the database** using `db.tx.collection[id].delete()`.

**DO NOT:**
- Use soft deletes (marking as `deleted: true` or `status: 'deleted'`)
- Leave orphaned records in the database
- Keep temporary/backup copies of deleted data
- Archive records instead of deleting them

**DO:**
- Call `db.transact(db.tx.collection[id].delete())` to hard delete
- Clean up cascading records:
  - Deleting business → also delete all teamMembers, leads, invoices, automations, etc.
  - Deleting lead → also delete related quotations, activityLogs for that lead
  - Deleting team member → also delete their attendance records, assignments
- Keep database clean and memory-efficient
- No duplicates or orphaned records left behind

**Example (CORRECT):**
```javascript
// Hard delete lead and cascade
const txs = [
  db.tx.leads[leadId].delete(),
  db.tx.quotations[quotId].delete(),  // Related records
  db.tx.activityLogs[logId].delete()  // Audit trail for this lead
];
await db.transact(txs);
```

**Example (WRONG - don't do this):**
```javascript
// Soft delete - FORBIDDEN
await db.transact(db.tx.leads[leadId].update({ deleted: true }));  // ❌ WRONG
```

## CRITICAL: No Duplicate Records / No Orphans

**RULE:** Never allow duplicate records (same email, phone, userId) across collections that should be unique. When deleting from the UI, hard-delete the record AND ALL related records in the same transaction. Leaving orphaned records causes routing bugs, duplicate IDs, and data corruption.

**Real-world example that broke production:**
A user `techtogrowindia@gmail.com` had:
- `userProfiles` record (business owner — TECH TO GROW)
- `userCredentials` record (correct flags)
- Orphaned `partnerApplications` record (Approved Retailer)

The orphaned partner application caused MainApp.jsx to auto-redirect to the partner portal even though credentials were correct. **The user could not log in to their business workspace.** The partner application should have been deleted when the partner role was removed.

### Rules to Follow

1. **Before creating any record, check for existing duplicates by unique keys (email/phone/userId):**
   ```javascript
   const existing = await db.query({
     userCredentials: { $: { where: { email: cleanEmail } } }
   });
   if (existing.userCredentials.length > 0) throw new Error('Email already registered');
   ```

2. **When deleting from UI, cascade delete ALL related records in ONE transaction:**
   ```javascript
   const txs = [
     db.tx.userProfiles[profileId].delete(),
     db.tx.userCredentials[credId].delete(),
     db.tx.partnerApplications[partnerId].delete(),  // ← Don't forget this!
     db.tx.teamMembers[memberId].delete(),
     db.tx.memberProfiles[mpId].delete(),
   ];
   await db.transact(txs);
   ```

3. **Cross-collection uniqueness checks:**
   - An email should NOT exist in BOTH `userCredentials` (as owner) AND `partnerApplications` simultaneously
   - A phone number should NOT exist in both `leads` and `customers` (use `leadId` linkage)
   - A `userId` should map to exactly ONE `userProfiles` record

4. **When changing a user's role (owner ↔ partner, removing partner status, etc.):**
   - DELETE the obsolete records — do NOT just flip a flag
   - Verify no orphaned `partnerApplications`, `teamMembers`, or `memberProfiles` remain

### Audit Checklist Before ANY Delete

- [ ] Identified ALL collections that reference this entity (by id, email, phone, userId)
- [ ] All references are deleted in the SAME `db.transact()` call
- [ ] No flag-only "soft" updates left behind
- [ ] Post-delete verification: querying by the unique key returns 0 records across all relevant collections

### High-Risk Collection Pairs (Common Source of Orphans)

- `userCredentials` ↔ `userProfiles` ↔ `partnerApplications` ↔ `teamMembers` ↔ `memberProfiles`
- `leads` ↔ `customers` (linked via `leadId`)
- `quotations` ↔ `invoices` (linked via `quotationId`)
- `partnerApplications` ↔ partner-created `leads` / `orders`

**This rule works alongside Hard Delete Policy** — together they ensure a clean, duplicate-free, orphan-free database. Violation of this rule has caused login failures and data corruption in the past.

## CRITICAL: No Hardcoded Configuration Values

**NEVER hardcode configuration values like product categories, lead stages, sources, requirements, etc.** These MUST come from `userProfiles` settings (Business Settings), not from constants or code.

**Hardcoded values:**
- ❌ Default stages: `['New Enquiry', 'Quotation Created', 'Won', 'Lost']` in code
- ❌ Sources list: `['Direct Call', 'Website', 'Partner']` as constants
- ❌ Product categories: `['Electronics', 'Software', 'Consulting']` in dropdown
- ❌ Any dropdown with fixed list of options

**Correct approach:**
- ✅ Fetch from `userProfiles.stages`, `userProfiles.sources`, `userProfiles.productCats`, etc.
- ✅ Owner customizes in Business Settings
- ✅ Dropdown/UI uses customized values, not defaults
- ✅ New workspace gets sensible defaults, can be overridden

**Example:**

```javascript
// ❌ WRONG - Hardcoded
const STAGES = ['New', 'Contacted', 'Won', 'Lost'];
const stageOptions = STAGES.map(s => <option key={s}>{s}</option>);

// ✅ CORRECT - From settings
const { data } = db.useQuery({ userProfiles: { $: { where: { userId: ownerId } } } });
const profile = data?.userProfiles?.[0];
const stageOptions = (profile?.stages || DEFAULT_STAGES).map(s => <option key={s}>{s}</option>);
```

**When adding a new dropdown/list in any module, ask yourself:**
- "Can the user customize this list?"
- "Is this business-specific or truly universal?"
- If customizable: Store in `userProfiles` + add Business Settings UI
- If universal: Only then hardcode (rare — examples: Invoice statuses like "Draft"/"Sent"/"Paid" are hardcoded because they're system states)

**Business Settings location:**
- File: `src/components/Settings/` (or `src/components/Business/`)
- Where user can add/edit/remove custom values
- Stored in: `userProfiles.[ fieldName ]` array

### Known customizable `userProfiles` fields (use these — never hardcode)

| Field | Used for | Default fallback |
|---|---|---|
| `userProfiles.stages` | Lead stages | `DEFAULT_STAGES` from `utils/helpers.js` |
| `userProfiles.leadStages` | Subset of stages visible in Leads module | falls back to all `stages` |
| `userProfiles.disabledStages` | Stages hidden from UI but kept in DB | `[]` |
| `userProfiles.wonStage` / `lostStage` | Which stage = Won / Lost | last stage / `'Lost'` |
| `userProfiles.sources` | Lead sources | `DEFAULT_SOURCES` |
| `userProfiles.requirements` | Lead requirement / product interest | `DEFAULT_REQUIREMENTS` |
| `userProfiles.productCats` | Product categories | none — show "All" |
| `userProfiles.expCats` | **Expense categories** (used in Expenses + Expense Report filter) | none — hide the filter |
| `userProfiles.customFields` | Per-business custom lead/customer fields | `[]` |
| `userProfiles.roles` | Team roles + per-module action perms | `DEFAULT_ROLES` from `Teams.jsx` |

If you add a new customizable list, register it here.

### Rule extends to reports, filters, breakdowns, and exports

This isn't only about create/edit forms. **Any** dropdown, filter, group-by selector, breakdown table, chart legend, or CSV column that represents a business-defined category must read from `userProfiles`. Common offenders:

- ❌ Hardcoded category filter in a Report tab (`['Travel','Food','Office',...]`)
- ❌ Hardcoded source list in a Marketing campaign targeter
- ❌ Hardcoded stage list in a Kanban column header
- ✅ Filter dropdown options come from `profile.expCats` / `profile.sources` / `profile.stages`
- ✅ If the field is empty for a business, **hide the control** — don't fall back to a hardcoded list

**Real bug (May 2026):** First version of the Expense Report tab in `Reports.jsx` shipped without a category filter. When added, the dropdown was almost wired to a static array — caught and corrected to read `profile.expCats` instead. The fix: derive options from `profile.expCats`, render the filter only when it has entries, and filter all KPIs/breakdown/trend/detail consistently. Pattern to follow for any future filter.

### Checklist before adding any dropdown / filter / breakdown

- [ ] Is the list of options business-specific? → must come from `userProfiles`
- [ ] If `userProfiles.<field>` is empty / missing, what happens? (Prefer: hide the control; never show a hardcoded fallback in production UI)
- [ ] If a default is genuinely needed for first-run UX, it lives in `utils/helpers.js` as `DEFAULT_*` and is overridable by the saved profile
- [ ] The same source of truth is used everywhere this list appears (form, filter, report, export header)
- [ ] If it's a new customizable field, the row is added to the table above in `CLAUDE.md`

---

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

**`isModuleEnabled` is STRICT:** `modules[key] === true` (not `!== false`). A missing key = disabled.

### Module Registry — The THREE Files

When adding or removing a module, you **MUST** update all three:

#### 1. Teams.jsx — `MODULES` array (PascalCase keys)
**File:** `src/components/Work/Teams.jsx`

#### 2. Teams.jsx — `MODULE_TO_PLAN_KEY` mapping
Maps PascalCase permission keys → camelCase plan keys. `null` = always shown (Dashboard, Settings).

#### 3. AdminPanel.jsx — `ALL_MODULES` array (camelCase keys)
**File:** `src/components/Admin/AdminPanel.jsx`

#### 4. usePlanEnforcement.js — `VIEW_TO_MODULE` mapping
**File:** `src/hooks/usePlanEnforcement.js`
Maps sidebar nav item IDs → plan module keys.

**Always-allowed views** (never blocked): `dashboard`, `userprofile`, `settings`, `admin`, `apidocs`, `manual`, `appointment-settings`

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

## CRITICAL: Web ↔ API Parity — Update Both Together

**Every business-logic change made on the web MUST be reflected in the corresponding API endpoint(s) in the same commit.** The mobile app and other external clients consume the API — they don't read web components. If web and API drift, mobile silently breaks.

### Why this rule exists

Multiple production bugs caused by web/API drift:

1. **Mobile saw all 11k leads** because `/api/data?module=leads` had no assignee filter while the web `LeadsView` did
2. **Mobile bulk-imports bypassed `maxLeads`** because `performImport` had a plan-limit check but the API CRUD didn't
3. **Mobile call logs duplicated** because the web's dedup logic wasn't in `/api/call-logs` POST handler

Each of these took separate sessions to diagnose. The web change shipped fine, the API wasn't touched, and the mobile started returning wrong data.

### When this rule applies

Any change to:
- Permission checks (`perms.can(...)`, `isOwner`, role tiers)
- Plan limits (`isWithinLimit`, `maxLeads`, etc.)
- Validation rules (required fields, dedup, format checks)
- Filtering / visibility (assignee, stage, source, team-visibility)
- Field derivation (e.g. `deriveOutcome` for call logs, source normalisation `Retailer → Channel Partners`)
- Default values (`DEFAULT_STAGES`, `DEFAULT_SOURCES`, etc.)
- Cascade deletes / orphan prevention

### Checklist before committing any web business-logic change

- [ ] Identified all API endpoint(s) the mobile or external clients hit for this entity (`/api/data?module=X`, `/api/leads-page`, `/api/call-logs`, webhooks, etc.)
- [ ] Applied the same business rule server-side
- [ ] Verified both code paths use the same constants / helpers where possible (extract shared helpers to `api/_shared-*.js` rather than copy-pasting)
- [ ] Documented the parity in the relevant commit message

### Pattern: extract shared logic when web & server both need it

When a derivation/check is needed in both places (e.g. `deriveOutcome`, source normalisation, dedup fingerprint), put it in a small module that both can import — never duplicate the logic.

---

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

### Server-Driven Endpoints (use these instead of large subscriptions)

| Endpoint | Purpose | Caller |
|---|---|---|
| `POST /api/leads-page` | Paginated lead list + date-tab counts | Web LeadsView |
| `POST /api/dashboard-stats` | KPI aggregates (totals, sources, hot leads, calendar) | Dashboard |
| `POST /api/lead-check-duplicate` | Dedup check across leads + customers by phone/email | Customers, LeadsView |
| `POST /api/sync-won-leads` | Auto-sync Won-stage leads → customers collection | Customers (on mount) |
| `POST /api/call-logs-page` | Paginated call logs + rollup grouping + per-member team stats | Web CallLogs |
| `POST /api/team-stats` | Pre-aggregated per-member performance metrics (totalActivities, leadsWorked, leadsWon, callsMade, ...) | TeamReports |
| `POST /api/team-activity` | Raw activity logs for date range — only used for member drilldown drawer | TeamReports (lazy) |
| `GET /api/data?module=leads` | **Mobile-only (LEGACY, INSECURE).** Permission-driven filter by actorId | Mobile app |
| `ALL /api/secure-data` | **Secure replacement for `/api/data`.** Token-authenticated; identity derived from token | New app (migration target) |

Shared caches:
- **`api/_leads-cache.js`** (15s TTL) — `getLeadsForOwner(ownerId)`. Used by leads-page, dashboard-stats, lead-check-duplicate, sync-won-leads, call-logs-page, team-stats, team-activity, /api/data leads route.
- **`api/_call-logs-cache.js`** (30s TTL) — `getCallLogsForOwner(ownerId)`. Used by call-logs-page and team-stats.
- `team-stats.js` and `team-activity.js` have internal per-owner activity-logs caches.

**Rule:** any new endpoint that needs the full set of a large collection MUST use the shared cache helper — never spin up a one-off in-memory cache.

### API Security — `/api/secure-data` (token-authenticated replacement for `/api/data`)

**The legacy `/api/data` endpoint has NO authentication.** It trusts `ownerId` / `actorId` / `isOwner` straight from the query string, so anyone who knows an `ownerId` (a non-secret UUID that leaks via docs, app traffic, login responses) can **read AND write/delete an entire workspace**, and any caller can become "owner" just by omitting `actorId` or passing `isOwner=true`. It is being phased out.

**`api/secure-data.js`** is the secure replacement. Same query shape as `/api/data` (e.g. `?module=leads&srcFilter=Youtube`) but:

1. **Requires `Authorization: Bearer <token>`** — the InstantDB token returned by `/api/auth` at login (the `token` field).
2. **Verifies the token server-side** via `db.asUser({ token }).query({ $users: {} })` (the admin SDK has **no `verifyToken`**; this is the verification mechanism). Valid → one `$users` row `{ id, email }`; malformed → throws `Malformed parameter`; fake/expired → throws `Record not found`. All non-valid tokens → `401`.
3. **Derives identity (`ownerId` + `actorId` + `isOwner`) from the verified email — never from client params.** Client-supplied `actorId`/`isOwner`/`userEmail`/`myName`/`teamMemberId` are **stripped** (`IDENTITY_KEYS`) so they can't be spoofed. Email → `userProfiles` (owner) and/or `teamMembers` (member) builds an allow-list of workspaces. `?ownerId=` is honoured **only as a hint** and only if the user belongs to that workspace (else `403`); ambiguous multi-workspace with no hint → `400`.
4. **Delegates to `data.js`** after injecting the trusted identity into both `req.query` and `req.body`, so all visibility/filter/CRUD logic stays in ONE place — guaranteed parity with the legacy endpoint while both exist.

**Rule:** new clients (the new app) must call `/api/secure-data` with a bearer token. Do NOT add auth to `/api/data` (it would break old mobile builds mid-flight) — let the new app migrate, then delete `/api/data` + its `server.mjs` route. When deleting `/api/data`, keep `api/data.js` as the internal implementation that `secure-data.js` imports.

> **Verification gotcha:** `@instantdb/admin` (v0.22.x) exposes only `db.auth.createToken` / `signOut` — there is no `verifyToken`. Verify a refresh token by impersonating with `db.asUser({ token })` and reading `$users`. `createToken({ email })` is an ADMIN mint (no password) — never use it to "verify" a client token; only use it to issue tokens at login.

> **Express getter gotcha:** on Express, `req.query` is a **getter-only** property — `req.query = {...}` throws `Cannot set property query ... which has only a getter`. `secure-data.js` injects the trusted identity with `Object.defineProperty(req, 'query', { value, writable: true, configurable: true })` (and the same for `req.body`). Don't revert to direct assignment. (Caught only in production — local plain-object req mocks don't have the getter.)

#### Usage (how clients call it)

**The token goes in the `Authorization` HEADER, never in the URL** (tokens in URLs leak into logs/history/proxies). The URL carries only `module` + filters.

1. **Login** → `POST /api/auth` with `{ action:'login', email, password }` → response has `token` (+ `ownerUserId`, `teamMemberId`). Store the `token`.
2. **Every call:**
   ```
   GET https://crm.t2gcrm.in/api/secure-data?module=leads
   Header:  Authorization: Bearer <token>
   ```
   - **No `ownerId`/`actorId` in the URL** — identity is the token. To get a team member's view, log in AS that member and use THEIR token.
   - Missing/invalid header → `401`.

**Leads filter params** (same as `/api/data`, all optional, combinable with AND logic):
- `srcFilter=<source>` — exact source (after Retailer→Channel Partners normalization)
- `stgFilter=<stage>` — exact stage
- `staffFilter=unassigned` | `my` | `<exact assign name>` — `my` resolves to the token's user
- `assignedFrom=YYYY-MM-DD` / `assignedTo=YYYY-MM-DD` — `assignedAt` range
- Response: `{ count, counts:{all,today,tomorrow}, data:[...], _debug:{isOwner,ownerId,actorId,...} }`. Each lead carries `createdAt`, `assignedAt`, `followup`.

> `staffFilter=my` can't show fewer leads than the user's visibility allows. In a workspace with `teamCanSeeAllLeads=true` or an elevated (delete/viewAll) role, a member already sees ALL leads, so `staffFilter=my` still returns the full set. It only narrows to own-leads when the member is genuinely restricted.

### Shared Caches

**File:** `api/_leads-cache.js` (leads)

```javascript
import { getLeadsForOwner, invalidateLeadsCache } from './_leads-cache.js';
const leads = await getLeadsForOwner(ownerId); // cached, shared across endpoints
```

`api/team-activity.js` has its own per-owner activity-logs cache (same 15s TTL pattern). Any new endpoint that pulls a large collection must use or follow this pattern — never spin up a one-off in-memory cache.

### Components Already Migrated

| Component | Pattern used |
|---|---|
| `LeadsView.jsx` | Full server-driven pagination + counts via `/api/leads-page` |
| `Dashboard.jsx` | Stats via `/api/dashboard-stats`, refreshes every 30s |
| `Customers.jsx` | `/api/lead-check-duplicate` for dedup, `/api/sync-won-leads` on mount |
| `Quotations.jsx`, `Invoices.jsx`, `POSBilling.jsx`, `Projects.jsx`, `AllTasks.jsx`, `AMC.jsx` | **Modal-lazy-fetch** (see below) |
| `CallLogs.jsx` | Full server-driven pagination via `/api/call-logs-page` (items + counts + teamStats in one response) |
| `Reports.jsx` | Fetches the **entire** lead set via `/api/leads-page` (`mode:'list'`, large `pageSize`) + full activity logs via `/api/team-activity`; aggregates over all of it and date-filters client-side |
| `TeamReports.jsx` | Pre-aggregated stats via `/api/team-stats`; raw logs via `/api/team-activity` only when a member drilldown is opened |
| `Campaigns.jsx` | Fetches via `/api/leads-page` (up to 1000) on mount for targeting |

### Rule: Reports MUST aggregate over the ENTIRE dataset — never a filtered/capped subset (CRITICAL)

Reports compute totals, breakdowns, conversion %, and trends. They are only correct if they see **all** records for the workspace, then apply the date/source/stage filters **client-side** for display. Fetching a partial set silently undercounts every metric.

**Hard rules for any report computation:**
- **Fetch the full set.** Use a server endpoint that returns the complete collection — `/api/leads-page` with `mode:'list'` + a large `pageSize` (NOT `mode:'kanban'`, which caps at 1000 and returns only the newest-by-followup subset), `/api/team-activity` for activity logs, etc. Never rely on a paginated page, a kanban cap, or a `db.useQuery({ ...limit:N })` subscription for report data — `limit` has **no ordering guarantee** and returns arbitrary (often oldest) rows.
- **Date-filter in the client, after fetching all.** The report's date dropdown (This Month / This FY / Custom) filters the full set with `inRange()` — it must never be the thing that scopes the fetch (except as a pure server-side optimisation that still returns the complete in-range set, e.g. `/api/team-activity` filtering by `createdAt`).
- **Cross-entity reports need ALL of the joined entity.** e.g. Revenue-by-Source matches *this-period invoices* to *all-time leads* by name — the lead side must be the full set, or sources go missing.
- **When adding a new report tab,** confirm its data source returns everything; add it to the per-tab loading flag so the progress overlay shows while it loads.

**Real bugs this rule prevents:**
- *Leads by Source* showed IndiaMart = 19 for "This Month" while the Leads page had more — Reports fetched only 1000 leads (`mode:'kanban'`), so this-month leads outside the top-1000-by-followup were never counted. Every lead report (Source, Requirement, Pipeline, Funnel, Revenue-by-Source) was affected.
- *Stage Transitions* showed a near-empty matrix on busy workspaces — it read `db.useQuery({ activityLogs: limit:5000 })`, which returned the oldest 5000 rows (outside the selected window). Fixed by fetching the full range via `/api/team-activity`.

### Modal-Lazy-Fetch Pattern (for components that need leads only inside modals)

Most CRUD pages (Quotations, Invoices, AMC, Projects, AllTasks, POSBilling) only use leads to populate a "Select client" dropdown inside a create/edit modal. Don't subscribe to leads for those — fetch lazily when the modal opens:

```javascript
const [modalLeads, setModalLeads] = useState([]);
const fetchModalLeads = async () => {
  if (modalLeads.length > 0) return; // cached for this session
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

// Call inside every openCreate / openEdit:
const openCreate = () => { fetchModalLeads(); setModal(true); ... };
```

Use `modalLeads` in the dropdown options and in any `leads.find(name match)` on save (for stage-update side-effects). Never re-subscribe.

### Plan Limit Enforcement

- `usePlanEnforcement.js` — `isModuleEnabled(key)` returns `true` ONLY if `modules[key] === true` (explicit). Missing keys = disabled. This is intentional — new modules added to `ALL_MODULES` must not silently leak into existing plans.
- `AdminPanel.jsx` — `savePlan` normalizes all module keys to explicit `true/false` and all limit keys to `DEFAULT_LIMITS` baseline.
- **`maxLeads` default in `ALL_MODULES` is `10000`** — production businesses regularly exceed this. Set to `-1` (unlimited) per plan if the customer imports bulk leads. The single-lead form AND bulk import both enforce the limit.
- **Bulk import (`performImport` in LeadsView)** enforces `maxLeads`: calculates remaining slots, trims the import to fit, asks the user to confirm. `-1` = unlimited, no check.
- **Pre-fix gotcha (now fixed):** the single-lead-form `isWithinLimit` check used `leads.length` which was capped at 500 by the old subscription — so the limit was silently bypassed. Now reads `pageData.counts.total` from the server.

### Mobile vs Web API split — PERMISSION-DRIVEN MOBILE VISIBILITY

The web calls `/api/leads-page` (always passes `isOwner`, `teamCanSeeAllLeads`, `teamCanSeeUnassignedLeads`, `userEmail`, `myName` explicitly). The Flutter mobile app calls `GET /api/data?module=leads`. **Both endpoints must apply the SAME lead-visibility logic so web and mobile always return an identical lead set for the same user.** This is a hard parity requirement — see "Lead Visibility Parity" below.

#### Caller resolution on `/api/data?module=leads` (CRITICAL)

The endpoint resolves *who is calling* in this order:

1. **`actorId` → `teamMembers.id`** lookup (preferred — what the API docs tell integrators to send).
2. **Fallback: `userEmail` → `teamMembers.email`** lookup. This exists because older mobile builds followed the old API doc (which only listed `ownerId`) and never sent `actorId` — that silently treated every caller as the owner and **leaked all leads**. The email fallback means a missing/owner-matching `actorId` can no longer escalate to owner unless the email truly belongs to no team member.
3. Only if neither resolves to a team member is the caller treated as the **owner** (all leads).

**Why this matters:** `if (!actorId || actorId === ownerId) isOwner = true` was the bug — it assumed "no actorId means owner". A restricted team member calling with only `ownerId` got the full workspace. The fix in `api/data.js` resolves by email before defaulting to owner.

**The IDs come from the `/api/auth` Login response:** it returns `ownerUserId` (→ `ownerId`) and `teamMemberId` (→ `actorId`, null for owners). Integrators store both at login and reuse on every call.

#### Visibility rules (after caller is resolved)

Look up the resolved member's role in `userProfiles.roles[]` → `roleDef.perms.Leads`. Then:

| Caller | Sees |
|---|---|
| Owner (resolved to no team member) | All leads |
| Team member with `Leads: [..., 'delete']` or `[..., 'viewAll']` (elevated) | All leads |
| Team member, `teamCanSeeAllLeads === true` | All leads |
| Team member, `teamCanSeeAllLeads === false`, `teamCanSeeUnassignedLeads !== false` | Leads where `assign === their email/name` **+ unassigned** |
| Team member, `teamCanSeeAllLeads === false`, `teamCanSeeUnassignedLeads === false` | **Only** leads where `assign === their email/name` (no unassigned) |

- **Two visibility toggles** live in `userProfiles` (set in Settings → Team Permissions): `teamCanSeeAllLeads` (master) and `teamCanSeeUnassignedLeads` (only relevant when master is off). Both default to `true` when the field is **`undefined`** (i.e. `field !== false`).
- **`undefined` default gotcha (cost a debugging session):** if a business never toggled the setting, `teamCanSeeAllLeads` is `undefined`, which the server reads as `true` → team members see all leads. When debugging "team member sees all leads", **check the actual DB value** — `undefined` means it was never saved. The Settings toggle now writes an explicit `false`.
- **Why `delete`/`viewAll` is the elevated proxy:** the default `Sales`/`Marketer` roles lack `delete`; `Admin` has it. Legacy `string[]` perms (`perms: ['Leads']`) convert to `{ Leads: ['list','view'] }` → own leads only; re-save with granular perms to elevate.
- Optional `staffFilter` / `srcFilter` / `stgFilter` query params narrow further but **cannot expand beyond the user's allowed set**.

#### Lead Visibility Parity (web ↔ mobile ↔ dashboard)

`/api/leads-page`, `/api/data?module=leads`, AND `/api/dashboard-stats` must each apply, in this order, BEFORE any counts/pagination:

1. **Source normalization** — `Retailer`/`Retailers` → `Channel Partners`
2. **Stage visibility** — `savedLeadStages` (a.k.a. `userProfiles.leadStages`) + `disabledStages`
3. **Team visibility** — the toggle + elevated-role logic in the table above

If any endpoint skips one of these, web and mobile counts drift (real bug: mobile showed 7322 vs web 739 because mobile skipped stage visibility AND defaulted to owner). When you touch lead visibility, update **all three endpoints together** and verify with a script that compares lead-id sets.

**If you add a new module to `/api/data`:** decide whether it needs the same caller-resolution + visibility (tasks, callLogs, appointments often do). The default raw `where: { userId: ownerId }` is not safe for any module with per-user assignment.

#### `assignedAt` field on leads

Leads carry an **`assignedAt`** timestamp recording when the lead was assigned to its current owner. Written in both `LeadsView.jsx` and `api/data.js`:
- **Create with assignee** → `assignedAt = createdAt`
- **Assign / reassign** (web save or API PATCH) → `assignedAt = Date.now()`
- **Unassign** (`assign === ''`) → not touched (no false date)

It is returned as-is by the GET lead API (no field stripping). Filterable via `dateMode: 'assigned'` on `/api/leads-page` and `assignedFrom`/`assignedTo` query params on `/api/data?module=leads`. **Leads assigned before this field shipped have no `assignedAt`** — a one-time backfill (`assignedAt = createdAt` for assigned leads) is needed if historical assigned-date filtering is required.

### Symptoms of the Scale Bug (for diagnosis)

- Dashboard shows "Total Leads: 0" or "9999" — leads subscription truncated
- Page stuck on "Loading..." spinner permanently — subscription handle-receive timeout
- Date tab counts unchanged when staff filter changes — staffFilter not being sent server-side
- Team Performance metrics show 0 across all date filters — activity logs subscription returning arbitrary rows outside the date window (no ordering guarantee)
- Mobile shows all leads instead of "my" leads — usually one of: (a) `actorId` not sent so caller defaults to owner (now mitigated by `userEmail` fallback), (b) `teamCanSeeAllLeads` is `undefined` in DB so it reads as `true`, or (c) mobile skipped stage/source filters so its count differs from web. Verify by curling the prod endpoint and comparing lead-id sets to `/api/leads-page`.

## Call Logs Integrity (CRITICAL)

Call logs sync from the Android app via `/api/call-logs` POST batch and have been the source of two production data-integrity bugs.

### Rule 1: Server-side dedup fingerprint (in API)

The mobile app sometimes re-sends the same call (retry, app restart, second device, upgrade). Every POST to `/api/call-logs` (single or batch) builds a fingerprint per entry and skips matches:

```javascript
fingerprint = `${last10digits(phone)}|${direction}|${floor(createdAt/60000)}|${duration||0}|${staffEmail||''}`;
```

Minute-bucketing the timestamp is intentional — the Android app can send the same physical call with ms-level drift. Exact-timestamp matching would miss those.

**Dedup runs against existing rows AND deduplicates within the same batch.** Returns `{ created, skipped, lastSyncedAt }`.

**Performance rule — 48h dedup window:** Fingerprints are built from the **last 48 hours of existing logs only** (not all 27k+). Duplicates never arrive more than 48h after the original call. Scanning the full history on every batch POST would grow unbounded over time. The shared `_call-logs-cache.js` is used (never a fresh `db.query`) — fingerprinting costs zero extra DB calls.

**Device sync state (`callLogSyncState` collection):** The server tracks the last successful sync timestamp **per device per owner**. Fields: `deviceId`, `ownerId`, `staffEmail`, `staffName`, `lastSyncedAt`, `lastSyncAt`, `totalSynced`. This is the authoritative record — survives app reinstalls, upgrades, and cache clears on the device.

```
Android sync flow (correct):
  1. GET /api/call-logs?ownerId=x&action=sync-state&deviceId=x
     → { nextSyncFrom: 1716030000000 }   (0 = first sync ever)
  2. POST { ownerId, deviceId, batch: calls.filter(c => c.createdAt > nextSyncFrom) }
     → { created, skipped, nextSyncFrom: 1716033600000 }
  3. Store nextSyncFrom for next time (optional — server is the source of truth)
```

**Three-layer dedup on batch POST (in order of cheapness):**
1. `createdAt <= deviceLastSyncedAt` → skip instantly (O(1), no fingerprint needed)
2. Fingerprint match in last 48h existing logs → skip (cache hit, no DB query)
3. Duplicate within same batch → skip

**Cache invalidation:** After every successful write (batch or single), `invalidateCallLogsCache(ownerId)` is called so the next `call-logs-page` request reflects the new rows immediately.

### Rule 2: Duration is the only honest signal of "Connected"

The Android sync sometimes sends `outcome: 'Connected'` on calls that had zero duration (mobile-side label bug). The codebase trusts **duration alone** for connectedness everywhere:

- Server (`deriveOutcome` in `api/call-logs.js`): `duration > 0` ⇒ `Connected`; `duration === 0` + `outcome === 'Connected'` ⇒ overridden to `No Answer`; specific non-connected reasons (Busy, Voicemail, Wrong Number) preserved
- UI row badge (`CallLogs.jsx`): `isConnected = duration > 0`
- Team summary: `connected = filter(l => duration > 0)`, `notPicked = filter(l => duration === 0)`
- Rollup grouping: `isUnpickedCall = (l) => !l.duration || Number(l.duration) === 0` — **never** check outcome

If you write new code that depends on connectedness, use duration. Treating `outcome === 'Connected'` as truth is a bug.

### Rule 3: Repeat-attempt UI rollup

Consecutive unpicked calls (duration 0) to the same `phone + direction + staffEmail` within 24 hours collapse into a single synthetic row with `attemptCount`, `firstAttemptAt`, `lastAttemptAt`, `groupedIds`. Connected calls always render individually. Deleting a grouped row deletes all `groupedIds` in one transaction.

Toggle "Group repeats" in the toolbar (persisted to `localStorage` per user). The grouping window constant is `REPEAT_GROUP_WINDOW_MS` in `CallLogs.jsx`.

### Rule 4: No manual cleanup buttons

Database hygiene (deduping legacy rows, backfilling bad outcome labels) is done as **one-shot migrations** — not via admin-panel buttons. When a data-quality bug surfaces in production:

1. Write a standalone migration script (e.g. `_migrate-call-logs.mjs`) using `@instantdb/admin`
2. Run it locally with the prod `.env`
3. Delete the script after run; commit only the prevent-recurrence guard (server-side fingerprint, hardened `deriveOutcome`, etc.)

This keeps the UI clean and the migration auditable in git history (see commit `e69a929`). Don't ship one-time fixes as buttons users have to find and click.

## Known Limitations

- No formal test suite (manual QA)
- No TypeScript (plain JavaScript)
- CSS-only styling (no Tailwind or CSS-in-JS framework)
- Chunk loading errors reload page once (lazy boundary handler)
- No service worker or offline support

## Useful Commands for Debugging

```bash
# Check what's in localStorage (for lead view config, registration data, etc)
Object.keys(localStorage).forEach(k => console.log(k, localStorage.getItem(k)));

# Inspect InstantDB queries
window.__INSTANT_DEBUG__ = true;  // If available

# Check permissions in console
window.DEBUG_PERMS = true;

# Monitor cron job (server logs)
npm run dev  # Tail console for "process-automations" logs
```

## Related Files to Read First

- **Understanding the app:** `src/App.jsx` (routes), `src/components/Layout/MainApp.jsx` (main UI)
- **Understanding auth:** `api/auth.js`, `src/components/Auth/`
- **Understanding data flow:** `src/components/Leads/LeadsView.jsx` (example of full CRUD)
- **Understanding automation:** `/api/cron/process-automations.js`
- **Understanding integrations:** `src/components/System/Integrations.jsx` + respective handlers

---

**This codebase is deployed on a Contabo VPS (Node.js + Express). Production is https://crm.t2gcrm.in; staging is https://dev.t2gcrm.in. It demonstrates enterprise patterns: multi-tenancy, real-time sync, role-based access, email automation, and modular feature architecture.**
