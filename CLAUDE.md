# CLAUDE.md

## Project Overview

**T2GCRM** is a B2B SaaS CRM for SMBs — leads, customers, invoices, projects, appointments, e-commerce, automation. Multi-tenant, modular architecture.

**Key Markets:** India (IndiaMART, JustDial, TradeIndia, WhatsApp via Waprochat)

**⚠️ PRODUCTION APP:** Live with real users and real data. Verify every change won't break existing functionality or corrupt data. Never run destructive operations without explicit user approval.

**📝 SELF-DOCUMENTING RULE:** After any critical change (new module, bug fix, architectural decision, new API, schema change), update **both** `GEMINI.md` and `CLAUDE.md` immediately. Don't wait to be asked.

## Tech Stack

- **Frontend:** React 18 + Vite, hash-based routing
- **Backend:** Node.js + Express.js
- **Database:** PostgreSQL 17 (live in prod & dev); InstantDB retained as dormant rollback target
- **Auth:** InstantDB magic codes + password (bcrypt); PG path: JWT via `api/auth-pg.js`
- **Email:** nodemailer (SMTP), EmailJS (frontend)
- **Styling:** Plain CSS

## 🐘 PostgreSQL Migration (PROD IS LIVE ON POSTGRES)

**Prod and dev both run on self-hosted PostgreSQL 17** (Contabo VPS). Prod cutover was completed — prod `.env` has `USE_PG_DATA=true`, `VITE_USE_PG_AUTH=true`, `VITE_USE_PG_DATA=true`. Architecture: one DB per app (`t2gcrm_prod`, `t2gcrm_dev`), row-level multi-tenancy (RLS), owner(DDL)+app(DML) roles, no real-time (refetch-after-mutation). InstantDB remains only as a dormant rollback target.

**Migration scripts** live in `/root/crm-migration/` on VPS (not in this repo):
`install-postgres.sh`, `create-crm-schema.sh`, `import.mjs`, `verify.mjs`, `05-add-write-triggers.sql`

### Status — migration complete
- ✅ Reads/writes on PG: `db.useQuery` proxied in `src/instant.js`, `dbWrite` in `src/utils/dbWrite.js`, all server endpoints via `_leads-cache`/`_call-logs-cache` (dual-path).
- ✅ **Auth fully on PG** (`api/auth-pg.js`): password login, magic-code, **register + verify-otp (public self-signup)**, change/reset-password, set-team/partner-password, delete-partner-credentials.
- ✅ **Admin fully on PG** (`api/auth-pg.js`): `admin-create-user`, `admin-delete-user`, `business-analytics`, `cleanup-old-logs`, `scan-orphans`, `cleanup-orphans`.

**Rollback:** remove the 3 `*PG*` env vars from prod `.env`, `npm run build && pm2 restart t2gcrm`. Back on InstantDB in ~3 min. (InstantDB data is stale post-cutover — rollback is emergency-only.)

### ⚠️ Auth/Admin routing — the #1 PG gotcha
On the PG stack, **login reads Postgres**. Any auth/admin action hardcoded to `/api/auth` writes to **InstantDB**, which login never reads — so the change silently does nothing (this bit password reset, create-business, and delete-business).

- **Frontend MUST use `AUTH_API`** (`src/utils/authApi.js`), NOT a hardcoded `/api/auth`, for every action implemented in both backends: login, register, verify-otp, change/reset-password, admin-create-user, admin-delete-user, business-analytics, cleanup-old-logs, orphan scan/cleanup, set-team/partner-password. `AUTH_API` → `/api/auth-pg` when `VITE_USE_PG_AUTH=true`.
- **New-business creation (accounts row) happens ONLY via `auth-pg` `admin-create-user` / `verify-otp`.** The normal `userProfiles` write path in `data-pg.js` is **UPDATE-only** (`UPDATE accounts SET doc=… WHERE id=…`) — it NEVER inserts an accounts row. So a brand-new business with no accounts row can't log in (password or magic code) until one of those two actions creates the `accounts` + `credentials` rows.
- **Duplicate credentials:** an email may wrongly have >1 credential row (owner + partner/team). PG login/magic-code prefer the **owner** (non-team/non-partner) credential and apply owner-priority (if the email owns an `accounts` row, treat as owner). Never `rows[0]` blindly.
- **OTP emails** go through the shared `api/_email-otp.js` (`sendOtpEmail`). NEVER return the raw OTP in the API response (that let anyone reset any account by knowing the email). Unverified self-signups are blocked at login until verify-otp completes.
- **Partner/team logout** must call `pgAuthSignOut()` (from `useAuthPg.js`) when `VITE_USE_PG_AUTH` — `db.auth.signOut()` is a no-op on PG and leaves the JWT in localStorage.

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

**Remote:** https://github.com/techtogrowindia/t2gcrm_webapp — **always push to `main`** (moved here from `G0kulakrishnan/crm` to end credential conflicts; old repo is the `old-gk` remote, kept as backup)

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

**⚠️ THE DEPLOY SCRIPTS SILENTLY BUILD STALE CODE.** `~/restart-t2gcrm.sh` and
`~/dev-restart-t2gcrm.sh` run `git pull origin main`, which fails with
`fatal: could not read Username for 'https://github.com'` — and the script
carries on to `npm run build` and restart anyway. The deploy *looks* successful
while serving the previous code. This has burned multiple sessions.

**ALWAYS verify after deploying** — never trust the script's output:
```bash
git -C /var/www/t2gcrm log --oneline -1     # must match origin/main
```
For an API-only change, also confirm the behaviour changed: a `git pull` updates
files but does NOT reload Node. Fix the root cause once with
`git config --global credential.helper store` + one manual `git pull`.

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
                  _shared-dates.js  _shared-perms.js  _shared-dashboard-widgets.js
                  dashboard-widgets.js  field-usage.js
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

Prod is on PG, so the live path is `/api/auth-pg`; route the frontend through `AUTH_API` (see the Auth/Admin routing gotcha above), never a hardcoded `/api/auth`.

1. **Password:** POST `/api/auth-pg` `action:'login'` → JWT. Login selects the owner credential among duplicates and blocks unverified self-signups.
2. **Magic code:** `/api/auth-pg` `send-code` → `verify-code` (`login_codes` table on PG).
3. **Self-signup:** `/api/auth-pg` `register` (creates unverified credential + emails OTP) → `verify-otp` (creates the `accounts` tenant row + marks verified + returns JWT).
4. **Discovery:** team member → restricted MainApp; partner → PartnerApp; owner → full MainApp.

**Gotcha — Team/Partner passwords:** Must set `is_verified: true` on the `credentials` row (PG). Without it, they get blocked at the OTP prompt (they have no `accounts`/`userProfiles` record to bypass it).

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

## Lead Assignment — by NAME, never email

`lead.assign` holds the team member's **name** everywhere. Reports, team stats,
visibility filters and the web all match on it.

- **The server normalises on write** (`api/_assignee.js` → `resolveAssignee`,
  called from `api/data.js`): an assignee arriving as a name OR an email is
  stored as the canonical **name** plus `assignedToId`. Any client sending an
  email is repaired automatically — this is why it's done server-side.
- **Never filter leads by email.** The mobile app queried
  `assign == staffEmail`, so leads assigned on the web never appeared in it.
- **Owners have no team-member record**, so they have no name of their own. Get
  the assignee list from `/api/lead-form-config` → `assignees`, not from the
  logged-in user, or an owner sees their raw email address.
- `assignedToId` is the migration target (see the memory note); reads still
  match on name, so both must stay in sync.

## Mobile App (Flutter)

**Repo:** https://github.com/techtogrowindia/T2GCRM_MobileApp — cloned into
`mobile/` (its own git repo; `CRM-PRO` was the origin it was forked from).
Flutter 3.38.5, package `crm_call_logger`. Screens: Leads, Call Logs,
Attendance.

**Mobile reads the API, never web components** — so every business-logic change
on web must be mirrored server-side in the same commit (see Web ↔ API Parity).

### Lead form config — use `/api/lead-form-config`
`GET /api/lead-form-config?ownerId=X` is the ONLY endpoint that returns the full
per-business form config: `stages`, `sources`, `requirements`, `productCats`,
`customFields`, `assignees`, `wonStage`, `lostStage`.

⚠️ Querying `settings` via `/api/data-pg` or `/api/secure-data` returns neither
`customFields` nor `productCats`. The app did that for months, which is why
custom fields never appeared on mobile however a business configured them.

**Use the exact key names it returns.** The app read `labels`/`leadLabels`/`b0`
for the Requirement list — the endpoint returns **`requirements`** — so every
business silently got the hardcoded `Hot/Warm/Cold` fallback instead of its own
list. Same class of bug as querying `settings` and never seeing `customFields`.
A wrong key here fails *silently into a default*, which is why it went unnoticed.

**Custom field `options` may be a LIST or a comma-separated STRING.** Real data
uses both (ARS stores `"Chennai, Coimbatore, ..."` for District). Handle both, or
dropdown fields render as free-text boxes. `type: 'number'` fields want a
numeric keypad.

### Lead CRUD from mobile
| Action | Method | Endpoint |
|---|---|---|
| List | `GET` | `/api/data?module=leads&ownerId=X` |
| Create | `POST` | `/api/data?module=leads` |
| Update | **`PATCH`** | `/api/data?module=leads` (PUT returns 405) |
| Delete | `DELETE` | `/api/data` |

- Writes are **validated against the business config** — an unknown source or
  stage is rejected with `Invalid lead field(s)`, naming the config endpoint.
- Product is stored as BOTH `productName` and `productId`. Reports group on the
  name, so a free-text value will not tally.
- Custom fields go in `custom: { "<field name>": value }`.
- `assignedToId` is stamped server-side when `assign` is set — do not send it.

### Testing
Use `techtogrowindia@gmail.com` = tenant `4fe042a3-118c-43b6-b321-7dc31646a1d7`
on **dev** (`https://dev.t2gcrm.in`). Note it has NO custom fields configured, so
custom-field rendering must be checked against a tenant that does (ARS,
`b4561e12-...`). `techtogrow2024@gmail.com` is a DIFFERENT tenant
(`b7c3576d-...`) — don't confuse the two.

⚠️ `flutter pub get` needs **Developer Mode** enabled on Windows (symlink
support): `start ms-settings:developers`. Without it the SDK can't resolve and
`flutter analyze` reports thousands of false errors. `dart format --output=none
<file>` still parse-checks a file without it.

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
10. **SYSTEM_SMTP_* env vars power both magic-code AND OTP emails** (`api/_email-otp.js`). If reset/verify emails don't arrive, check these on the VPS `.env` — the magic-code path working confirms SMTP is fine.

## Finance — Documents, Numbering & Totals

- **Invoice/quotation numbering comes from Settings > Financial**, not hardcoded. Next number = `<prefix>` + `max(startingNumber, highestExisting+1)`, padded to 3 (`iPrefix`/`iNextNum`, `qPrefix`/`qNextNum` on `userProfiles`). Never re-hardcode `INV/<year>/<count>`.
- **GST is computed on the POST-discount taxable value.** `src/utils/docTotals.js` `computeDocTotals` is the single shared math for BOTH renderers (`DocumentTemplate.jsx` HTML/print + `DocumentPdf.jsx` react-pdf) — the document-level discount is apportioned across line items via a factor so per-rate CGST/SGST/IGST stays correct. Any total-derivation change happens HERE only. Reopening an existing discounted doc re-renders with the corrected (lower) GST.
- **Templates:** "Formal Quote" is a distinct template (`profile.invoiceTemplate`/`quotationTemplate === 'Formal'`). The **Opening Note** field (`data.quoteFor`) only shows on the form when that template is active, and only the Formal template renders it. Terms render as-typed (no auto-numbering).
- **Client picker** (`SearchableSelect`): searches by name AND phone (`searchKeys={['phone']}`), and type-ahead hits `/api/leads-page` server-side so it finds any lead, not just a preloaded page. Still stores the client by **name** (not id) — same-name disambiguation is a known limitation.

## Leads — Products, Address Parity & Bulk

- **Leads link ONE product** from the Products catalog: `productId` (the real link) + `productName` (denormalized, for display/reports). Shown on the lead form, detail view, table (Configure View "Product" column) and the "Leads by Product & Team" report.
- **EMPTY_LEAD mirrors EMPTY_CUSTOMER's address block** (`address/state/country/pincode/gstin`) so `convertToCustomer` carries the full field set (address block + custom fields + product) onto the customer — kept in parity with the server auto-sync in `api/sync-won-leads.js`.
- **Bulk multiselect toolbar** supports Assign / Change Stage / Change Requirement / **Assign Product** — all batched through `bulkApply` (200/batch, 4 in flight) with one summary activity-log row (`entityId:'bulk'`, an intentional synthetic id — NOT an orphan; exclude it from orphan scans).

## Notifications (bell + toast) — two SEPARATE persisted sets

`MainApp.jsx` keeps two per-tenant localStorage id sets (`usePersistedIdSet`), deliberately not shared:
- `readNotifIds` (`tc_read_notifs_<tenant>`) — bell panel/badge; only changed by an explicit user action (click a notif or "Mark all read"). Panel shows only unread; each item has a ✕ to clear.
- `toastedNotifIds` (`tc_toasted_notifs_<tenant>`) — toast dedup only; toasting must NEVER silently mark a notif read (that made "50 Overdue Follow-ups" vanish from the bell). Never prune ids by "not in current liveNotifs" — the overdue bucket loads async and would re-toast every refresh; use the size cap instead.
- The **Follow-up Notification** setting (`profile.followupNotifyMinutes`, 0=Off) is the master switch for BOTH overdue and advance follow-up alerts.

## Reports — team pivots & follow-up status

- **Team-pivot reports** (Source×Team, Stage×Team, Product×Team) share one render/export block in `Reports.jsx`; rows built dynamically from data (don't hide orphaned values), Unassigned as its own column, respect the From/To date filter.
- **Follow-up Status report** infers outcomes from activity (no dedicated field): Converted = now in Won stage; Rescheduled = a "Follow Up changed" activity log exists; Attended = other activity logged; Untouched = none. Plus "Total Leads" / "No Follow-up Date" (both by createdAt in range) and a per-team-member breakdown.
- **wonStage fallback:** when `profile.wonStage` is unset, prefer a stage literally named "Won" before the last-stage fallback (the last stage is often "Competitors"/"Lost", which silently zeroed conversions).

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
| `POST /api/team-activity` `mode:'summary'` | Per-lead `[lastActivityMs, lastRescheduleMs]` + `movedFrom` (Follow-up Status) — 17x smaller than raw logs |
| `POST /api/dashboard-widgets` | Batched data for server-backed dashboard widgets; JWT-authed, permissions resolved server-side |
| `POST /api/field-usage` | "Do records still use this configured value?" — gates delete/disable in Settings |
| `POST /api/leads-page` `{leadId}` | Single lead by id, after visibility filtering (deep links) |
| `POST /api/lead-check-duplicate` | Dedup check by phone/email (Customers, LeadsView) |
| `POST /api/sync-won-leads` | Won leads → customers sync (Customers on mount) |
| `GET /api/data?module=leads` | **Mobile-only (legacy, unauthenticated)** |
| `ALL /api/secure-data` | Secure token-authenticated replacement for `/api/data` |

**Shared caches (always use, never create one-off caches):**
- `api/_leads-cache.js` (15s TTL) — `getLeadsForOwner(ownerId)`
- `api/_call-logs-cache.js` (30s TTL) — `getCallLogsForOwner(ownerId)`

**Modal-lazy-fetch pattern** — components that only need leads in a "Select client" dropdown: fetch once on modal open via `/api/leads-page`, cache in `useState`. Don't subscribe.

## Dates — one parser, `api/_shared-dates.js`

Finance and lead records do **not** all store dates the same way. Use
`parseDateValue` / `startOfDayMs` / `endOfDayMs` / `inDateRange` — never
`new Date(str)` on a stored value.

- **`new Date('2026-07-27')` parses as UTC.** In +05:30 that lands at 05:30
  local, so a range built that way silently drops the first 5.5 hours of the
  day. `'2026-07-27T00:00:00'` (no designator) parses as LOCAL. Same process,
  same timezone — the *string form* decides. The VPS being IST is irrelevant.
- **A string ending in `Z` or `±HH:MM` is unambiguous** — hand it to the engine.
  Rebuilding it from its parts as local shifts it by the offset. Reports pass
  `new Date(ms).toISOString()`, which always ends in Z.
- **Bad values must not vanish.** `new Date()` returns Invalid Date for epoch
  strings and typo'd years, and `d >= from && d <= to` is FALSE for Invalid
  Date — so those rows disappeared from every report. On production that was 8
  invoices and 5 expenses missing from P&L, GST and Revenue by Source.
- The parser is forgiving about FORM (epoch number/string, `YYYY-MM-DD`, ISO
  with time, typo'd year like `52026-09-15`) and strict about PLAUSIBILITY
  (rejects years outside 2000–2100, so a typo can't drag a record to the far
  future). Typo'd years are fixed by deleting ONE digit — truncating to the last
  four turns `20026` into `0026`.

**Writers must store `'YYYY-MM-DD'`.** `api/ecom/checkout.js` wrote epoch ms and
that is where the 8 unreadable invoices came from.

## GST compliance

- **Place of supply is frozen on the document.** `placeOfSupply` and
  `supplierState` are stamped at save; `resolveGstSplit()` reads those first and
  only falls back to the live customer for older records. It used to be decided
  at PDF render from whichever customer matched the client NAME — so an
  unmatched client (lead, one-off, renamed) silently produced CGST+SGST on an
  inter-state sale, and editing a customer's state later changed an already
  issued invoice. A GST invoice must be fixed at issue.
- `resolveGstSplit` returns `known:false` when neither side is established.
  Present that as "not set", never as a confident split.
- **HSN/SAC** is mandatory per line. Products already store one; selecting a
  product copies it onto the line. Held as a STRING — codes can start with a
  zero and `parseFloat` would silently change the code.
- **Reverse charge** is a required declaration and prints either way.
- **GST Summary is rate-wise**: taxable value + CGST/SGST/IGST per rate, using
  `computeDocTotals` — the same function the invoice and PDF use, so the report
  agrees with the paperwork (including GST charged AFTER discount). Invoices
  with no place of supply are shown as CGST+SGST but COUNTED and surfaced.

⚠️ Invoices issued before this have no `placeOfSupply` and still fall back to
the live customer. Backfilling would rewrite the tax position on already-issued
documents — owner's decision, not a cleanup to run.

## Payments Received

A payment is a receipt, not an amount: `{ no, date, amount, mode, reference,
notes, createdAt, actorId, userName }`.

- Payments stay inside `invoice.payments`. A receipt only exists against an
  invoice, so keeping them together makes an orphan structurally impossible.
  The cost is reading invoices to list payments — fine for a small collection,
  wrong for leads or call logs.
- **Receipt numbers run in ONE sequence across all invoices** (`nextPaymentNo`,
  `profile.payPrefix` / `payNextNum`). Gaps are left alone rather than history
  renumbered.
- Dates are `'YYYY-MM-DD'`. They used to be `Date.now()`, unreadable by every
  date-range report.
- Modes come from `profile.paymentModes` (defaults in helpers), not a hardcoded
  list.
- Legacy payments have no number/mode/reference — render what exists, show a
  dash, never fabricate a number.
- `PaymentReceiptPdf.jsx` is lazily imported; react-pdf is a 1.5 MB chunk.
- The page rides the **Invoices** permission and plan key. A new module key
  would hide it from everyone until every plan was re-saved.

## Proforma invoices

`docType: 'Quotation' | 'Proforma'` on **quotes**, not invoices. A proforma is
not revenue and carries no GST liability — in `invoices` it would inflate P&L,
GST Summary, Revenue by Source, the dashboard and receivables. Quotes feed no
financial total, so that is the safe home, and convert-to-invoice is inherited.
Own numbering series (`pfPrefix` / `pfNextNum`, default `PI-`) counted only
against other proformas. The PDF states it is not a tax invoice.

## Stages: the system must not fight the configuration

A lead in a disabled stage is invisible in every report while still sitting in
the database. Eight ARS leads were stranded in "Quotation Created" this way.

- **Auto-transitions respect `disabledStages`.** Quotations/Invoices move leads
  to 'Quotation Sent', 'Invoice Created', the won stage and so on — via
  `autoStagePatch()`, which withholds only the stage if its target is disabled.
  Each of the 7 transitions is judged on its OWN target. Enrichment (email,
  phone), customer creation and the activity log still happen; the log says
  what actually occurred.
- **Guard the WRITE path, not just the picker.** CSV import validated against
  `allStages` (disabled included) and bulk apply passed raw values — both now
  use `sanitizeStage()`.
- **Webhooks coerce, never reject** (`coerceLeadStage` in `_lead-config.js`).
  IndiaMART/JustDial/TradeIndia/Sheets map the remote payload straight on. An
  inbound enquiry must never be dropped over a bad field — a lead in a slightly
  wrong stage is recoverable, one never created is not.
- **Settings refuses to delete or disable a value records still use**
  (`/api/field-usage`): stages, sources, requirements, product categories,
  custom fields, expense categories, product units, task/order statuses. Counts
  server-side on the leads cache. Re-enabling stays instant. A list it can't
  check reports `checked:false` so the caller warns rather than reading silence
  as a clean bill of health.

## Whitespace splits string-keyed reports

Assignees, products and stages are matched by string, and stray spaces split one
value into several rows/columns — `"Kanaka Shree"`, `"Kanaka  Shree"` and
`"Kanaka Shree "` became three columns each holding part of her leads. Totals
still reconciled, which is why it went unnoticed; the per-person distribution
was wrong. **Normalise BOTH sides** (`normName`) — cleaning one side is worse
than cleaning neither, which is how `"Cow Mat "` split into two product rows.

Report rows seed from the CATALOGUE, not only from values found in the data:
6 of ARS's 11 products had no row at all, while team members with no leads did
get a column.

## Customizable Dashboard

Each person arranges their own dashboard; nobody else's changes.

- **Catalogue:** `api/_shared-dashboard-widgets.js` — imported by BOTH browser
  and server. Every widget carries its `requires: ['Module:planKey']` gate
  (`match:'any'` for either-or). **Never fork this list** — two copies drift,
  and the drift always fails open.
- **Layout storage:** `userProfiles.dashboardLayout` (owner) /
  `memberProfiles.dashboardLayout` (member, keyed by `doc.userId`). Both are
  `doc jsonb` — no migration. localStorage mirrors it so a layout survives a
  failed write. Presets are COPIED on first login, never linked.
- **Data:** original widgets use Dashboard.jsx's own queries (permission-gated
  at the QUERY, not just the render). Widgets marked `server:true` come from
  `POST /api/dashboard-widgets` — one batched request, identity from the
  verified bearer token, permissions resolved by `api/_shared-perms.js`.
- **`_shared-perms.js` mirrors `usePermissions` + `usePlanEnforcement`** —
  including the legacy `string[]` perms format and "missing plan key =
  disabled". Fails closed. Keep it in step when either hook changes.

**Adding a widget:** (1) entry in `_shared-dashboard-widgets.js`, (2) renderer
in Dashboard.jsx `TILES`/`SECTIONS` (id must match exactly), (3) if
`server:true`, compute it in `dashboard-widgets.js` AND add it to the `need`
map — a widget missing from `need` silently reports zeros. (4) `to:` must be a
real view id from MainApp's `views`.

**Gotchas hit building this:**
- `shell()` is a plain function, not a component. A component declared in a
  render body remounts its children every pass — the calendar reset its month.
- Widgets are only wrapped while editing: `.stat-grid`/`.dash-grid-2` style
  DIRECT children, so an always-on wrapper changes the layout.
- Drill-down clones the element instead of wrapping, for the same reason.

⚠️ **Not enforced anywhere:** `api/data-pg.js` applies tenant isolation (RLS)
only — no per-module role check. A team member can read any collection in
their own tenant by calling it directly. App-wide gap; the widget gate does
not close it.

## Notifications (bell + pop-ups)

Built in `MainApp.jsx` (`liveNotifs`), rendered by `NotifPanel.jsx` + toasts.

- **Follow-up alerts cover TODAY only, never overdue.** A business carrying
  hundreds of overdue leads got a permanent alert it could never clear, so it
  became noise. Overdue stays on the Dashboard and the Leads "Overdue" filter.
- **"Today" is the caller's local day.** The client sends `dayStartMs`/`dayEndMs`
  to `/api/dashboard-stats`; never derive midnight server-side (VPS TZ != IST).
- **Server lists must be deterministically ordered before capping.** Sort, then
  `slice(50)` — never cap inside the scan loop. Combined notifications ack
  per-lead via `_ackIds`, so an unstable order changes the ids every poll and a
  dismissed alert comes straight back. This was a real bug.
- **Report the true count, not the sample length** — `totals.today` /
  `totals.overdue`, not `array.length` (which is just the cap, hence the
  perpetual "50 Overdue Follow-ups").
- **Two separate persisted id sets**, deliberately not shared:
  `tc_read_notifs_<tenant>` (bell/badge, only user actions) and
  `tc_toasted_notifs_<tenant>` (pop-up dedup). Toasting must never mark read.
- **Mute toggle** (`tc_notif_muted`, bell-off icon in Topbar) suppresses pop-ups
  only — the bell still counts and lists everything. While muted, new items are
  still marked toasted so un-muting doesn't dump the whole backlog.
- `profile.followupNotifyMinutes` = 0 silences ALL follow-up alerts.

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
