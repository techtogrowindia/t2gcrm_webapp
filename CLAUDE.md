# CLAUDE.md

## Project Overview

**T2GCRM** is a B2B SaaS CRM for SMBs — leads, customers, invoices, projects, appointments, e-commerce, automation. Multi-tenant, modular architecture.

**Key Markets:** India (IndiaMART, JustDial, TradeIndia, WhatsApp via Waprochat)

**⚠️ PRODUCTION APP:** Live with real users and real data. Verify every change won't break existing functionality or corrupt data. Never run destructive operations without explicit user approval.

**📝 SELF-DOCUMENTING RULE:** After any critical change (new module, bug fix, architectural decision, new API, schema change), update **both** `GEMINI.md` and `CLAUDE.md` immediately. Don't wait to be asked.

## Tech Stack

- **Frontend:** React 18 + Vite, hash-based routing
- **Backend:** Node.js + Express.js
- **Database:** InstantDB (real-time NoSQL) + PostgreSQL 17 (migration in progress)
- **Auth:** InstantDB magic codes + password (bcrypt); PG path: JWT via `api/auth-pg.js`
- **Email:** nodemailer (SMTP), EmailJS (frontend)
- **Styling:** Plain CSS

## 🐘 PostgreSQL Migration (IN PROGRESS)

Migrating to **self-hosted PostgreSQL 17** on Contabo VPS. Architecture: one DB per app (`t2gcrm_prod`, `t2gcrm_dev`), row-level multi-tenancy (RLS), owner(DDL)+app(DML) roles, no real-time (refetch-after-mutation).

**Migration scripts** live in `/root/crm-migration/` on VPS (not in this repo):
`install-postgres.sh`, `create-crm-schema.sh`, `import.mjs`, `verify.mjs`, `05-add-write-triggers.sql`

### Status
- ✅ Postgres 17 installed, 4 DBs, owner/app roles, nightly backups
- ✅ CRM schema (31 tables) + RLS + `login_codes` in prod & dev
- ✅ `t2gcrm_dev` imported & verified (69,547 rows)
- ✅ `api/db-pg.js` — pool + `tenantQuery`/`rawQuery`/`tenantTransaction`
- ✅ `api/auth-pg.js` — password + magic-code + JWT (all 3 flows)
- ✅ `api/data-pg.js` — generic upsert/delete/batch/query, all 31 tables
- ✅ `api/_write-ops.js` — shared write router (InstantDB ↔ Postgres)
- ✅ `api/_leads-cache.js` + `api/_call-logs-cache.js` — dual-path PG/InstantDB
- ✅ All server endpoints: `api/data.js`, `team-stats.js`, `dashboard-stats.js` reads route to PG
- ✅ Frontend: `db.useQuery` globally proxied in `src/instant.js`; `dbWrite` in `src/utils/dbWrite.js`
- ✅ Dev CRM fully running on Postgres (auth + reads + writes)
- ⬜ Prod cutover: run `import.mjs` + `05-add-write-triggers.sql` on `t2gcrm_prod`, set 3 env flags, build + restart

### Prod Cutover Steps
1. `git pull && pm2 restart t2gcrm` (pull bug fixes first)
2. Run `05-add-write-triggers.sql` on `t2gcrm_prod` (owner role)
3. Run `import.mjs` while app is live (pre-warm)
4. `pm2 stop t2gcrm` → run `import.mjs` again (delta) → edit `.env` → `npm run build` → `pm2 start t2gcrm`
5. Add to prod `.env`: `USE_PG_DATA=true`, `VITE_USE_PG_AUTH=true`, `VITE_USE_PG_DATA=true`, `DATABASE_URL` (app role), `JWT_SECRET` (openssl rand -hex 32)

**Rollback:** remove those 5 env vars, `npm run build && pm2 restart t2gcrm`. Back on InstantDB in ~3 min.

### Write/Read Architecture
- **Writes:** `dbWrite(dbOp.update/delete)` → `/api/data-pg` (JWT). MERGE-upsert (partial updates only touch provided fields). Cascade deletes via `CASCADE` map in `data-pg.js`. Promoted typed columns maintained by triggers, not the write path.
- **Reads:** `data-pg action:'query'` returns `{ ...doc, id: r.id }` — id ALWAYS from PG column.
- **Gotcha:** `id` lives in the PG column, not necessarily in `doc`. All mappers do `{ ...r.doc, id: r.id }`.
- **Not in PG:** `memberStats`, task auto-numbering — skipped gracefully (`execOp` returns `[]`).

### Schema Mapping
- `userId` → `tenant_id` on every tenant table. **Exception: `callLogSyncState` uses `ownerId`.**
- `userProfiles` → `accounts`; `userCredentials` → `credentials`; `globalSettings` → `global_settings`
- Auth tables have no RLS (needed before tenant is known)
- Import runs as OWNER role (bypasses RLS); app runs as APP role (RLS enforced)
- Credentials: `/root/pg_credentials.txt` on VPS

## Git Repository

**Remote:** https://github.com/G0kulakrishnan/crm — **always push to `main`**

```bash
git add <files> && git commit -m "msg" && git pull origin main --rebase && git push origin main
```

**MANDATORY:** Commit and push after every code change. No uncommitted work. No permission needed to push.

## Build & Run

```bash
npm run dev      # Vite dev server (localhost:5173)
npm run build    # Production build
npm start        # Express server (port 3000)
```

**VPS deployment:**
- **API-only change** (`api/*.js`, `server.mjs`): `git pull` + `pm2 restart t2gcrm` — no build needed
- **Frontend change** (`src/**`): `git pull` + `npm run build` + `pm2 restart t2gcrm`
- **Production:** https://crm.t2gcrm.in — `pm2` id 0, app at `/var/www/t2gcrm`
- **Dev/staging:** https://dev.t2gcrm.in — `pm2` id 2, app at `/var/www/dev-t2gcrm`

## Project Structure

```
src/components/   Admin/ Leads/ Finance/ Work/ Ecommerce/ Dashboard/ Auth/ Layout/
                  Appointments/ Business/ CallLogs/ Clients/ Reports/ Settings/
                  System/ Automation/ UI/
src/hooks/        usePermissions.js  usePlanEnforcement.js  useAutomationEngine.js
                  usePgQuery.js  useAuthPg.js  useData.js
src/utils/        helpers.js  constants.js  activityLogger.js  messaging.js  dbWrite.js
src/              instant.js  App.jsx  main.jsx

api/              auth.js  auth-pg.js  data.js  data-pg.js  secure-data.js
                  finance.js  notify.js  call-logs.js  call-logs-page.js
                  leads-page.js  dashboard-stats.js  team-stats.js  team-activity.js
                  lead-check-duplicate.js  lead-counts.js  lead-lookup.js
                  sync-won-leads.js  attendance.js  _leads-cache.js  _call-logs-cache.js
                  _write-ops.js  cleanup-duplicates.js
api/cron/         process-automations.js  process-wa-amc.js  process-wa-followup.js
                  process-integrations.js
api/webhook/      gsheets.js  indiamart.js  justdial.js  tradeindia.js
api/ecom/         checkout.js
api/appointments/ book.js

server.mjs        # Express server (production) — ALL routes must be registered here
```

## Key Architecture Patterns

- **Multi-tenant:** every record has `userId` (InstantDB) / `tenant_id` (Postgres) for isolation
- **Writes:** `dbWrite(dbOp.update/delete)` from `src/utils/dbWrite.js` — routes to PG or InstantDB by flag
- **Reads (frontend):** `db.useQuery` proxied in `instant.js` — routes to `usePgQuery` when `VITE_USE_PG_DATA=true`
- **Server reads:** `readData(db, ownerId, spec)` from `_write-ops.js`; caches via `_leads-cache.js` / `_call-logs-cache.js`
- **Permissions:** `perms?.can('ModuleName', 'action') === true` — received as prop from MainApp
- **Plan enforcement:** `planEnf.isModuleEnabled('key')` / `isWithinLimit('key', count)` — prop from MainApp
- **Hardcoded restriction:** team members cannot access Admin or Settings regardless of role

## Database Collections (InstantDB → Postgres table)

| Collection | PG Table | Notes |
|---|---|---|
| `userProfiles` | `accounts` | id = tenant's userId |
| `userCredentials` | `credentials` | no RLS |
| `teamMembers` | `team_members` | |
| `leads` | `leads` | hot table, promoted typed columns |
| `customers` | `customers` | |
| `quotes` | `quotes` | **NOT** `quotations` |
| `invoices` | `invoices` | |
| `activityLogs` | `activity_logs` | hot table |
| `callLogs` | `call_logs` | hot table |
| `callLogSyncState` | `call_log_sync_state` | uses `ownerId` not `userId` |
| `tasks` | `tasks` | |
| `projects` | `projects` | |
| `appointments` | `appointments` | |
| `attendance` | `attendance` | |
| `products` | `products` | |
| `vendors` | `vendors` | |
| `purchaseOrders` | `purchase_orders` | |
| `expenses` | `expenses` | |
| `amc` | `amc` | |
| `orders` | `orders` | |
| `ecomCustomers` | `ecom_customers` | |
| `automations` | `automations` | |
| `executedAutomations` | `executed_automations` | |
| `globalSettings` | `global_settings` | no RLS |
| `partnerApplications` | `partner_applications` | |
| `partnerCommissions` | `partner_commissions` | |
| `outbox` | `outbox` | |

## Authentication & Login Flow

1. **Password:** POST `/api/auth` (InstantDB) or `/api/auth-pg` (PG) → JWT
2. **Magic code:** `db.auth.sendMagicCode()` → `db.auth.signInWithMagicCode()` (InstantDB) or `login_codes` table (PG)
3. **Discovery:** team member → restricted MainApp; partner → PartnerApp; owner → full MainApp

**Gotcha — Team/Partner passwords:** Must set `isVerified: true` on `userCredentials`. Without it, they get blocked at the OTP prompt (they have no `userProfiles` record to bypass it).

## Email Automation Engine

`/api/cron/process-automations.js` — runs every 60s. Trigger types: `stage-change`, `amc-expiry`, `new-appointment`, `ecom-order`. SMTP config per-business in `userProfiles`. Dedup via `executedAutomations`. Kill switch: `VITE_BLOCK_AUTOMATIONS=true`.

## WhatsApp Auto-Notification System (Waprochat)

**Flow:** component → `fireAutoNotifications()` in `src/utils/messaging.js` → `POST /api/notify` → Waprochat API

### Critical Rules — Never Break

1. **Variable names must exactly match Waprochat template variable names.** `#variableName#` in body → `templateVariable-<name>-<index>` in POST.
2. **`#phone#` is always excluded from variables** — it is the recipient `phone_number` field. Use `#leadphoneno#` / `#clientphoneno#` to put phone inside message body.
3. **`api/notify.js` is the sole outbox logger.** `fireAutoNotifications` must NOT also call `logToOutbox`.
4. **Use `v.name` not `v.field` in `notify.js`.** Variables are `{ index, name, value }`. Using `v.field` posts `templateVariable-undefined-N`.
5. **`processedKey` format:** `wa-auto-<ownerId>-<eventType>-<templateId>-<phone>-<entityId>`

### Auto-trigger Events & Variables

| Event key | When fires | Key variables |
|---|---|---|
| `lead_created` | New lead | `#lead#` `#client#` `#leadphoneno#` `#stage#` `#source#` `#requirement#` `#email#` `#date#` `#bizName#` |
| `lead_stage_changed` | Stage edited | `#lead#` `#client#` `#fromstage#` `#tostage#` `#assignee#` `#leadphoneno#` `#date#` |
| `lead_assigned` | Assigned/reassigned | `#lead#` `#client#` `#assignee#` `#leadphoneno#` `#stage#` `#date#` |
| `customer_created` | Lead → Won | `#lead#` `#client#` `#leadphoneno#` `#stage#` `#date#` |
| `quotation_created` | New quotation | `#client#` `#clientphoneno#` `#quoteno#` `#amount#` `#validuntil#` `#date#` `#bizName#` |
| `invoice_created` | New invoice | `#client#` `#clientphoneno#` `#invoiceno#` `#amount#` `#date#` `#bizName#` |
| `payment_received` | Payment logged | `#client#` `#clientphoneno#` `#invoiceno#` `#amount#` `#date#` `#bizName#` |
| `appointment_booked` | Booking submitted | `#client#` `#clientphoneno#` `#service#` `#apptDate#` `#apptTime#` `#bizName#` |
| `task_assigned` | New task with assignee | `#assignee#` `#task#` `#client#` `#duedate#` `#priority#` `#date#` |
| `lead_followup` | Daily cron, N days before followup | `#lead#` `#client#` `#assignee#` `#leadphoneno#` `#followupdate#` `#daysLeft#` `#date#` |
| `amc_expiry` | endDate ≤ 30 days / daily cron | `#client#` `#clientphoneno#` `#contractNo#` `#endDate#` `#daysLeft#` `#amount#` `#plan#` `#date#` |
| `order_placed` | E-commerce checkout | `#client#` `#clientphoneno#` `#orderId#` `#orderAmount#` `#orderStatus#` `#date#` `#bizName#` |

`#phone#` = recipient field (excluded from variables). Built-in date vars: `#today#` `#tomorrow#` `#+Nday#` (DD/MM/YYYY).

### Call Sites

| File | Events |
|---|---|
| `src/components/Leads/LeadsView.jsx` | `lead_created` `lead_stage_changed` `lead_assigned` `customer_created` |
| `src/components/Finance/Invoices.jsx` | `invoice_created` `payment_received` |
| `src/components/Finance/Quotations.jsx` | `quotation_created` |
| `src/components/Work/AllTasks.jsx` | `task_assigned` |
| `src/components/Appointments/BookingPage.jsx` | `appointment_booked` |
| `src/components/Ecommerce/StorePage.jsx` | `order_placed` |
| `src/components/Clients/AMC.jsx` | `amc_expiry` |
| `api/cron/process-wa-followup.js` | `lead_followup` |

**Add new trigger:** (1) add to `AUTO_TRIGGER_EVENTS` in `messaging.js` (2) call `fireAutoNotifications()` in component after DB write (3) add Insert Variable buttons in `Settings.jsx` (4) add to `WAVariableGuide.jsx` MODULES array (5) add row to table above.

### userProfiles WhatsApp Fields
`waApiToken`, `waPhoneId`, `whatsappTemplates[]`, `waNotifPhone` (owner recipient, include country code)

## Lead Integrations

| Source | Webhook | Auth | Dedup |
|---|---|---|---|
| Google Sheets | `/api/webhook/gsheets` | — | phone + email |
| IndiaMART | `/api/webhook/indiamart` | `GLUSR_CRMMOBILE_KEY` | phone + email |
| JustDial | `/api/webhook/justdial` | optional API key | phone + email |
| TradeIndia | `/api/webhook/tradeindia` | User ID + Profile ID + API Key | phone + email |

All integrations: field mapping (Column/Fixed), custom fields, enable/disable toggle, config in `userProfiles.<source>`.

**⚠️ server.mjs gotcha:** always add both `import` + `app.all(...)` for every new API file. Dev resolves dynamically; **production returns 404 until `server.mjs` is updated.** (TradeIndia was broken in prod for months this way.)

## Common Gotchas

1. InstantDB WHERE only supports exact match / simple operators — complex filters in JS after fetch
2. Transaction failures are silent — always wrap `db.transact` in try/catch
3. Hash-based routing — URLs use `/#/leads` not `/leads`
4. SMTP config is per-business — changing it affects all that owner's emails
5. Plan module keys are case-sensitive — Teams.jsx uses PascalCase (`Leads`), AdminPanel/usePlanEnforcement use camelCase (`leads`)
6. `isModuleEnabled` is strict — `modules[key] === true`. Missing key = disabled. Re-save existing plans after adding a new module
7. Never add `leads` to a component's `db.useQuery` — hangs at 11k+ rows. Use server endpoints
8. Server-paginated APIs (leads-page) only return ~25 rows client-side — dedup and search must go server-side
9. Disabled stages are filtered in components but still exist in DB — don't delete them

## Environment Variables

```
VITE_INSTANT_APP_ID=        # Frontend InstantDB app ID
INSTANT_ADMIN_TOKEN=        # Backend admin token
PORT=3000
VITE_BLOCK_AUTOMATIONS=false
# PG migration (dev/prod when live):
USE_PG_DATA=true
VITE_USE_PG_AUTH=true
VITE_USE_PG_DATA=true
DATABASE_URL=               # APP role: postgresql://t2gcrm_prod_app:<pass>@localhost:5432/t2gcrm_prod
JWT_SECRET=                 # openssl rand -hex 32
SYSTEM_SMTP_HOST/PORT/USER/PASS/FROM=   # for magic-code login emails
```

## Performance — MANDATORY RULES

Never skip these on any new or modified component.

- **Filter at DB level** — `where: { userId: ownerId }`, never fetch all and filter client-side
- **Defer drawer/modal data** — gate with `selectedId ? { activityLogs: ... } : {}`
- **Always limit activityLogs queries** — `limit: 200`, never unbounded
- **Lazy-load tab-specific data** — `db.useQuery(tab === 'team' ? { teamMembers: ... } : {})`
- **useMemo for all derived values** — filtered lists, counts, lookup maps, totals
- **O(1) index maps** — `Object.fromEntries(items.map(i => [i.id, i]))` instead of `.find()` inside `.map()`
- **Paginate all lists** — default 25 rows/page
- **Sticky table headers**, viewport-constrained height
- **Kanban in viewport** — `overflow-y: hidden` on container, columns scroll internally
- **Clear `tc_*` / `leads_cache_*` / `leadView_*` / `callLogView_*` localStorage keys on logout**
- **Never `console.log` in render path**

### New Page/Feature Checklist
- [ ] Query filtered by `userId: ownerId` at DB level
- [ ] Heavy data (logs, history) deferred to drawer query
- [ ] All derived values in `useMemo`
- [ ] No `.find()` / `.filter()` inside `.map()` — use index maps
- [ ] List paginated if >25 rows possible
- [ ] No `console.log` in render
- [ ] localStorage cleared on logout if caching anything

## CRITICAL: Hard Delete Only

All deletes must be permanent via `db.tx.collection[id].delete()` (or `dbWrite(dbOp.delete(...))` for PG path). **No soft deletes (`deleted: true`), no archiving.**

Cascade delete ALL related records in one transaction:
- Lead → activity_logs, tasks, appointments, call_logs
- Customer → activity_logs, tasks, appointments, call_logs, amc
- Project → activity_logs, tasks, expenses
- Vendor → activity_logs, purchase_orders
- Team member → userCredentials, attendance, memberStats

## CRITICAL: No Orphaned Records

Duplicate/orphaned records cause login bugs and data corruption (an orphaned `partnerApplications` record once redirected a business owner to the partner portal and blocked their login).

**Rules:**
1. Before creating, check for duplicates by unique keys (email/phone/userId)
2. Delete ALL related collections in one transaction — never flip a flag instead
3. An email must not exist in both `userCredentials` (owner) AND `partnerApplications` simultaneously
4. A `userId` maps to exactly ONE `userProfiles` record
5. When changing user role: DELETE obsolete records, don't just update flags

**High-risk orphan pairs:**
- `userCredentials` ↔ `userProfiles` ↔ `partnerApplications` ↔ `teamMembers` ↔ `memberProfiles`
- `leads` ↔ `customers` (via `leadId`)
- `quotes` ↔ `invoices` (via `quotationId`)

**Delete checklist:**
- [ ] All referencing collections identified
- [ ] All deleted in same transaction
- [ ] No soft-update left behind
- [ ] Query by unique key returns 0 rows post-delete

## CRITICAL: No Hardcoded Configuration

Never hardcode lead stages, sources, requirements, product categories, expense categories, or any business-defined list. Always read from `userProfiles`.

### Customizable userProfiles Fields

| Field | Used for | Fallback |
|---|---|---|
| `stages` | Lead stages | `DEFAULT_STAGES` (helpers.js) |
| `leadStages` | Visible subset of stages | all `stages` |
| `disabledStages` | Stages hidden from UI | `[]` |
| `wonStage` / `lostStage` | Won/Lost stage names | last stage / `'Lost'` |
| `sources` | Lead sources | `DEFAULT_SOURCES` |
| `requirements` | Lead requirement/interest | `DEFAULT_REQUIREMENTS` |
| `productCats` | Product categories | none — show "All" |
| `expCats` | Expense categories | none — hide the filter |
| `customFields` | Per-business custom fields | `[]` |
| `roles` | Team roles + permissions | `DEFAULT_ROLES` (Teams.jsx) |

**Rule extends to reports, filters, and exports** — every dropdown, filter, breakdown that represents a business-defined category must read from `userProfiles`. If the field is empty, hide the control.

**New dropdown checklist:**
- [ ] Is it business-specific? → read from `userProfiles`
- [ ] Empty field → hide control (never show hardcoded fallback)
- [ ] First-run defaults → `DEFAULT_*` in `utils/helpers.js`, overridable
- [ ] Same source used in form, filter, report, and export

## CRITICAL: Roles & Permissions

Every CRUD component must check permissions. Every page must be gated by plan enforcement.

- `perms?.can('ModuleName', 'action') === true` before every create/edit/delete
- `planEnf.isModuleEnabled('key')` gates page access
- `planEnf.isWithinLimit('key', count)` gates record creation
- Hide buttons when denied — don't just error on click
- `perms?.isOwner` / `perms?.isAdmin` for special-case logic

### Module Registry — Update ALL 4 Files When Adding a Module

1. `src/components/Work/Teams.jsx` — `MODULES` array (PascalCase key + actions)
2. `src/components/Work/Teams.jsx` — `MODULE_TO_PLAN_KEY` mapping (PascalCase → camelCase)
3. `src/components/Admin/AdminPanel.jsx` — `ALL_MODULES` array (camelCase key)
4. `src/hooks/usePlanEnforcement.js` — `VIEW_TO_MODULE` mapping (nav item id → plan key)

Always-allowed views: `dashboard`, `userprofile`, `settings`, `admin`, `apidocs`, `manual`, `appointment-settings`

**Module change checklist:**
- [ ] Added to Teams.jsx MODULES (PascalCase)
- [ ] Added to Teams.jsx MODULE_TO_PLAN_KEY
- [ ] Added to AdminPanel.jsx ALL_MODULES (camelCase)
- [ ] Added to usePlanEnforcement.js VIEW_TO_MODULE
- [ ] If has limits: `hasLimit: true`, `limitKey`, `defaultLimit` in ALL_MODULES
- [ ] Sidebar nav gated by `planEnforcement.isViewAllowed(viewId)`
- [ ] Existing plans re-saved in Admin Panel to include new key

## CRITICAL: Web ↔ API Parity

Every business-logic change on web must be mirrored in the API in the same commit. Mobile reads the API, not web components.

**Applies to:** permission checks, plan limits, validation, filtering/visibility, field derivation (`deriveOutcome`, source normalization), default values, cascade deletes.

**Checklist:**
- [ ] Identified all API endpoints for this entity (`/api/data?module=X`, `/api/leads-page`, `/api/call-logs`, webhooks)
- [ ] Same rule applied server-side
- [ ] Shared logic extracted to `api/_shared-*.js` (not duplicated)

## Scale Architecture — Server-Driven Pages

Production has 11k+ leads, 27k+ call logs. Never subscribe to large collections — use server endpoints.

**Never do:** `db.useQuery({ leads: { limit: 10000 } })` — times out, returns 0 or truncated. `limit: N` has no ordering guarantee — returns arbitrary (often oldest) rows.

### Server Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/leads-page` | Paginated leads + counts (web LeadsView) |
| `POST /api/dashboard-stats` | KPI aggregates (Dashboard) |
| `POST /api/call-logs-page` | Paginated call logs + team stats (CallLogs) |
| `POST /api/team-stats` | Per-member performance aggregates (TeamReports) |
| `POST /api/team-activity` | Raw activity logs for date range (TeamReports drilldown) |
| `POST /api/lead-check-duplicate` | Dedup check by phone/email (Customers, LeadsView) |
| `POST /api/sync-won-leads` | Won leads → customers sync (Customers on mount) |
| `GET /api/data?module=leads` | **Mobile-only (legacy, unauthenticated)** |
| `ALL /api/secure-data` | Secure token-authenticated replacement for `/api/data` |

**Shared caches (always use, never create one-off caches):**
- `api/_leads-cache.js` (15s TTL) — `getLeadsForOwner(ownerId)`
- `api/_call-logs-cache.js` (30s TTL) — `getCallLogsForOwner(ownerId)`

**Modal-lazy-fetch pattern** — components that only need leads in a "Select client" dropdown: fetch once on modal open via `/api/leads-page`, cache in `useState`. Don't subscribe.

### Reports Must Aggregate Over the Full Dataset

Reports are only correct if they see ALL records, then date-filter client-side. Never use a capped/paginated fetch for report data.
- Use `mode:'list'` with large `pageSize` for `/api/leads-page` (not `mode:'kanban'` — caps at 1000)
- Use `/api/team-activity` for activity logs (not `db.useQuery` with limit)
- Cross-entity reports (Revenue-by-Source) need all-time leads to match invoices by name

### Lead Visibility Rules (web ↔ mobile ↔ dashboard must match)

All three endpoints (`/api/leads-page`, `/api/data?module=leads`, `/api/dashboard-stats`) must apply in order:
1. **Source normalization** — `Retailer`/`Retailers` → `Channel Partners`
2. **Stage visibility** — `leadStages` + `disabledStages` filter
3. **Team visibility:**

| Caller | Sees |
|---|---|
| Owner | All leads |
| Team member with `Leads: delete` or `viewAll` perm | All leads |
| Team member + `teamCanSeeAllLeads === true` | All leads |
| Team member + `teamCanSeeAllLeads === false` | Assigned + unassigned (default) |
| Team member + `teamCanSeeAllLeads === false` + `teamCanSeeUnassignedLeads === false` | Own leads only |

**Gotcha:** `teamCanSeeAllLeads` is `undefined` by default (never saved) → reads as `true`. When debugging "team member sees all leads", check the actual DB value.

**Caller resolution on `/api/data?module=leads`:** (1) `actorId` → teamMembers.id, (2) fallback `userEmail` → teamMembers.email, (3) no match → owner. Never treat missing `actorId` as owner without email fallback.

### `/api/secure-data` — Token-Authenticated API

`/api/data` has no auth — trusts `ownerId` from query string. `/api/secure-data` is the secure replacement:
- Requires `Authorization: Bearer <token>` (token from `/api/auth` login)
- Verifies via `db.asUser({ token }).query({ $users: {} })` — no `verifyToken` in admin SDK
- Derives identity from verified email — client-supplied `actorId`/`isOwner` are stripped
- Delegates to `data.js` after injecting trusted identity

**Gotcha — Express getter:** `req.query = {...}` throws. Use `Object.defineProperty(req, 'query', { value, writable: true, configurable: true })`.

## Call Logs Integrity

### Dedup (3-layer, batch POST)
1. `createdAt <= deviceLastSyncedAt` → skip (O(1))
2. Stable ID match in last 48h logs → skip (cache hit)
3. Duplicate within same batch → skip

Stable ID = SHA1 of `phone|direction|duration|staffEmail|minute-bucket`. Minute-bucketing absorbs ms drift from mobile retries.

Device sync state stored in `callLogSyncState` per device/owner — survives reinstalls. Invalidate cache after every write: `invalidateCallLogsCache(ownerId)`.

### Connected = Duration > 0 (never trust `outcome`)
Android sometimes sends `outcome:'Connected'` on zero-duration calls. Override everywhere:
- `deriveOutcome()` in `api/call-logs.js`: `duration > 0` → Connected
- UI badge: `isConnected = duration > 0`
- Rollup grouping: `isUnpickedCall = !duration || Number(duration) === 0`

### Repeat-Attempt Rollup
Consecutive unpicked calls (duration 0) to same `phone + direction + staffEmail` within 24h collapse to one synthetic row (`attemptCount`, `groupedIds`). Delete grouped row → deletes all `groupedIds` in one transaction.

### No Cleanup Buttons
Data-quality fixes are one-shot migration scripts in `/root/crm-migration/`, not admin panel buttons.

## Common Development Tasks

### Adding a New API File
1. Create `api/newfile.js`
2. **Add import + `app.all('/api/newfile', wrap(handler))` in `server.mjs`** — mandatory or prod 404s
3. Register route in `vite.config.js` if needed for dev

### Adding a New Module
1. Component in `src/components/FeatureName/`
2. Route in `App.jsx` (hash route)
3. Nav item in `Sidebar.jsx` with `planEnf.isModuleEnabled('key')`
4. API handler in `api/`
5. Update all 4 module registry files (see Roles & Permissions section)

### Debugging
```bash
window.DEBUG_PERMS = true      # Trace permission checks
window.__INSTANT_DEBUG__ = true # InstantDB query debug
# Check localStorage keys:
Object.keys(localStorage).forEach(k => console.log(k, localStorage.getItem(k)))
```

## Landing Page (t2g-landing)

**Separate project** at `C:\Users\Gokul\Projects\t2g-landing` — completely independent from the CRM repo. No build step, no framework, no package.json.

- **Files:** `index.html` (all markup) + `styles.css` (all styles)
- **Preview:** configured in `.claude/launch.json` as `"landing"` — runs `npx http-server` on port 4187. Start with `preview_start("landing")`.
- **CSS variables:** `--accent:#22c55e`, `--accent2:#16a34a`, `--accent-dark:#15803d`, `--border:#e2e8e4`
- **Button classes:** `.btn-primary` (solid green fill) · `.btn-ghost` (transparent, outline only) · `.btn-white` · `.btn-outline-white`
- **No git remote configured** in this folder — edits are local only unless pushed separately.

## Known Limitations
- No test suite (manual QA)
- No TypeScript
- Plain CSS only
- No service worker / offline support

---
**Production:** https://crm.t2gcrm.in (pm2: `t2gcrm`, `/var/www/t2gcrm`) | **Dev:** https://dev.t2gcrm.in (pm2: `dev-t2gcrm`, `/var/www/dev-t2gcrm`) | **VPS:** Contabo, `/root/pg_credentials.txt`, `/root/crm-migration/`
