# Off-site Postgres backups → Google Drive

Frequent (every 2h) `pg_dump` of `t2gcrm_prod` (+ `t2gcrm_dev`) pushed **off the
server** to Google Drive with `rclone`. This exists because on 2026-08-08 a host
snapshot restore reverted the VPS ~9 days and took the on-machine daily backups
with it — off-machine copies make that a non-event.

Files (in the repo, so a wiped crontab/script is one command to restore):
- `ops/pg_backup_offsite.sh` → deploy to `/usr/local/bin/pg_backup_offsite.sh`
- `ops/t2gcrm-backup.cron` → deploy to `/etc/cron.d/t2gcrm-backup`

---

## One-time setup (run as root on the VPS)

### 1. Install rclone
```bash
sudo -v ; curl https://rclone.org/install.sh | sudo bash
```

### 2. Create the Google Drive remote named `gdrive`
The box is headless, so authorize on a machine that HAS a browser:
- On your laptop: install rclone, run `rclone authorize "drive"`, complete the
  Google sign-in, and copy the JSON token it prints.
- On the VPS: `sudo rclone config` → `n` (new remote) → name **`gdrive`** →
  storage **`drive`** → accept defaults → when it asks *"Use auto config?"*
  answer **`n`** and paste the token from the step above.
- Tip: create a dedicated folder in that Drive (the script uses `t2gcrm-backups/`).

Verify: `sudo rclone lsd gdrive:` should list your Drive folders.

### 3. Deploy the script + cron
```bash
sudo cp ops/pg_backup_offsite.sh /usr/local/bin/pg_backup_offsite.sh
sudo chmod 700 /usr/local/bin/pg_backup_offsite.sh
sudo cp ops/t2gcrm-backup.cron /etc/cron.d/t2gcrm-backup
sudo chmod 644 /etc/cron.d/t2gcrm-backup
```

### 4. (optional) override defaults in `/etc/t2gcrm-backup.env`
```bash
# DATABASES="t2gcrm_prod t2gcrm_dev"
# RCLONE_REMOTE=gdrive
# RCLONE_BASE=t2gcrm-backups
# MIN_ACCOUNTS=1        # prod is skipped if it has fewer accounts than this
# KEEP_LOCAL=24         # local dumps kept per db
# REMOTE_KEEP_DAYS=14   # Drive copies older than this are pruned
```

### 5. Test once, then it runs every 2h automatically
```bash
sudo /usr/local/bin/pg_backup_offsite.sh
sudo tail -20 /var/log/t2gcrm-backup.log
sudo rclone lsl gdrive:t2gcrm-backups/t2gcrm_prod/    # you should see a .dump
```

---

## Safety guard (important)
The script **refuses to upload** a prod dump that is tiny **or** whose
`accounts` count is `0`. This is deliberate: after the 2026-08-08 restore, prod
was briefly empty — without this guard an hourly job would have uploaded an
empty prod and pruned away the good copies. **Enable the cron only once prod has
real data.** The remote prune also only runs when at least one good upload
happened this run, so it can never delete its way down to nothing.

---

## Restore from a Google Drive backup (pure Postgres, no InstantDB)
```bash
# 1. pull the dump you want
sudo rclone copy gdrive:t2gcrm-backups/t2gcrm_prod/t2gcrm_prod_2026-08-09_1400.dump /tmp/

# 2. (recommended) verify it on a throwaway DB first
sudo -u postgres createdb t2gcrm_restore_check
sudo -u postgres pg_restore -d t2gcrm_restore_check /tmp/t2gcrm_prod_2026-08-09_1400.dump
sudo -u postgres psql -d t2gcrm_restore_check -c "SELECT count(*) FROM accounts, (SELECT count(*) FROM leads) l"
sudo -u postgres dropdb t2gcrm_restore_check

# 3. restore into prod (app should be stopped: pm2 stop t2gcrm), then restart
sudo -u postgres pg_restore --clean --if-exists -d t2gcrm_prod /tmp/t2gcrm_prod_2026-08-09_1400.dump
pm2 restart t2gcrm
```
