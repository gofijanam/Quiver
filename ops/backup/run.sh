#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${DATABASE_URL:?Missing PostgreSQL connection}"
: "${BACKUP_S3_ENDPOINT:?Missing backup endpoint}"
: "${BACKUP_S3_BUCKET:?Missing backup bucket}"
: "${AWS_ACCESS_KEY_ID:?Missing backup credentials}"
: "${AWS_SECRET_ACCESS_KEY:?Missing backup credentials}"
case "$BACKUP_S3_ENDPOINT" in
  https://*) ;;
  *) echo 'Backup storage must use HTTPS.' >&2; exit 2 ;;
esac

work=$(mktemp -d)
cleanup() {
  if [[ -f "$work/pg/postmaster.pid" ]]; then
    pg_ctl -D "$work/pg" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  rm -rf -- "$work"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

archive="$work/quiver.dump"
bash /app/database-backup.sh backup "$archive"

mkdir -m 700 "$work/socket"
initdb -D "$work/pg" --no-locale --auth=trust >/dev/null
pg_ctl -D "$work/pg" -l "$work/pg.log" \
  -o "-h 127.0.0.1 -p 55432 -k $work/socket" -w start >/dev/null
QUIVER_EMPTY_RESTORE_URL='postgresql://postgres@127.0.0.1:55432/postgres?sslmode=disable' \
  bash /app/database-backup.sh restore "$archive"
fenced=$(psql 'postgresql://postgres@127.0.0.1:55432/postgres?sslmode=disable' \
  -XAtq -v ON_ERROR_STOP=1 -c "SELECT payload->>'restoreHold' FROM quiver_state WHERE id = 'paper-beta'")
[[ "$fenced" == "true" ]] || { echo 'Restore hold missing.' >&2; exit 1; }
pg_ctl -D "$work/pg" -m fast -w stop >/dev/null

export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}" AWS_PAGER=""
export AWS_CONFIG_FILE="$work/aws-config"
export AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED
aws configure set default.s3.addressing_style path
key="postgres/$(date -u +%Y%m%dT%H%M%SZ)-$(basename "$work").dump"
object="s3://$BACKUP_S3_BUCKET/$key"
s3=(aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3)
read -r checksum _ < <(sha256sum "$archive")
"${s3[@]}" cp "$archive" "$object" --only-show-errors
stored_checksum=$("${s3[@]}" cp "$object" - --only-show-errors | sha256sum)
stored_checksum=${stored_checksum%% *}
[[ "$checksum" == "$stored_checksum" ]] || { echo 'Stored backup checksum mismatch.' >&2; exit 1; }
printf 'Backup %s uploaded, read back and restored with execution held.\n' "$key"
