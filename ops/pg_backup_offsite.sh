#!/usr/bin/env bash
# =============================================================================
# T2GCRM off-site Postgres backup  ->  Google Drive (via rclone)
#
# WHY THIS EXISTS: on 2026-08-08 a host snapshot restore reverted the whole VPS
# ~9 days and took the *on-machine* daily backups with it. Frequent + off-machine
# copies make that a non-event. Runs every 2h from /etc/cron.d/t2gcrm-backup.
#
# WHAT IT DOES, per database:
#   1. pg_dump (custom/compressed format) to a local temp file
#   2. SAFETY GUARD: refuse to upload a dump that is too small, and for prod
#      refuse if it has < MIN_ACCOUNTS accounts -> so a broken/empty prod can
#      NEVER overwrite your good off-site backups
#   3. rclone copy the dump to Google Drive
#   4. prune old local copies; prune remote copies older than N days
#      (remote prune only runs if at least one upload succeeded this run)
#
# ONE-TIME SETUP (a human, as root): see ops/BACKUP-SETUP.md
#   - install rclone, run `rclone config` to create a remote named "gdrive"
#   - deploy this script to /usr/local/bin/ and the cron to /etc/cron.d/
#
# Must run as root (needs `su postgres` for pg_dump and rclone's root config).
# =============================================================================
set -uo pipefail

# ---- config (override any of these in /etc/t2gcrm-backup.env) ---------------
[ -f /etc/t2gcrm-backup.env ] && . /etc/t2gcrm-backup.env

DATABASES="${DATABASES:-t2gcrm_prod t2gcrm_dev}"     # space-separated list
LOCAL_DIR="${LOCAL_DIR:-/var/backups/postgres/offsite}"
RCLONE_REMOTE="${RCLONE_REMOTE:-gdrive}"             # rclone remote name
RCLONE_BASE="${RCLONE_BASE:-t2gcrm-backups}"         # folder inside the remote
MIN_BYTES="${MIN_BYTES:-1000000}"                    # skip upload if dump < ~1 MB
MIN_ACCOUNTS="${MIN_ACCOUNTS:-1}"                    # skip prod if accounts < this
KEEP_LOCAL="${KEEP_LOCAL:-24}"                       # keep newest N local dumps / db
REMOTE_KEEP_DAYS="${REMOTE_KEEP_DAYS:-14}"           # delete remote copies older than
LOG="${LOG:-/var/log/t2gcrm-backup.log}"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG" >&2; }

command -v rclone >/dev/null 2>&1 || { log "FATAL: rclone not installed (see ops/BACKUP-SETUP.md)"; exit 1; }
rclone listremotes 2>/dev/null | grep -q "^${RCLONE_REMOTE}:" || { log "FATAL: rclone remote '${RCLONE_REMOTE}:' not configured"; exit 1; }
mkdir -p "$LOCAL_DIR"

uploaded=0
fail=0
for DB in $DATABASES; do
  TS=$(date +%Y-%m-%d_%H%M)
  OUT="$LOCAL_DIR/${DB}_${TS}.dump"

  if ! su postgres -c "pg_dump -Fc -d '$DB'" > "$OUT" 2>>"$LOG"; then
    log "ERROR: pg_dump $DB failed"; rm -f "$OUT"; fail=1; continue
  fi

  SIZE=$(stat -c%s "$OUT" 2>/dev/null || echo 0)
  if [ "$SIZE" -lt "$MIN_BYTES" ]; then
    log "SKIP $DB: dump only ${SIZE} bytes (< ${MIN_BYTES}) — looks empty/corrupt, NOT uploading"
    rm -f "$OUT"; fail=1; continue
  fi

  if [ "$DB" = "t2gcrm_prod" ]; then
    N=$(su postgres -c "psql -d '$DB' -tAc 'SELECT count(*) FROM accounts'" 2>>"$LOG" | tr -dc '0-9')
    if [ -z "${N:-}" ] || [ "$N" -lt "$MIN_ACCOUNTS" ]; then
      log "SKIP $DB: only ${N:-?} accounts (< ${MIN_ACCOUNTS}) — refusing to overwrite good backups with an empty prod"
      rm -f "$OUT"; fail=1; continue
    fi
  fi

  if rclone copy "$OUT" "${RCLONE_REMOTE}:${RCLONE_BASE}/${DB}/" >>"$LOG" 2>&1; then
    log "OK: uploaded ${DB}_${TS}.dump (${SIZE} bytes) -> ${RCLONE_REMOTE}:${RCLONE_BASE}/${DB}/"
    uploaded=$((uploaded+1))
  else
    log "ERROR: rclone upload of $DB failed"; fail=1
  fi

  # prune local: keep newest KEEP_LOCAL per db
  ls -1t "$LOCAL_DIR/${DB}_"*.dump 2>/dev/null | tail -n +"$((KEEP_LOCAL+1))" | xargs -r rm -f
done

# prune remote ONLY if we actually uploaded something this run (never prune into nothing)
if [ "$uploaded" -gt 0 ]; then
  rclone delete --min-age "${REMOTE_KEEP_DAYS}d" --drive-use-trash=false "${RCLONE_REMOTE}:${RCLONE_BASE}/" >>"$LOG" 2>&1 || true
fi

exit "$fail"
