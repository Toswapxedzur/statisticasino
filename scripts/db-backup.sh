#!/bin/bash
# Nightly MySQL backup of Bluffing Valley — WITHOUT play history (owner policy 2026-09-07:
# history lives only in the 7-day hot window + the home replay archive; it is never backed up).
# Excluded: match_replay, match_replay_player (replays), poker_hand, poker_hand_player (hand
# history), hand_canonical, hand_upload (imported captures). Everything else — users, wallets,
# chip_ledger, friends, conversations/messages, achievements, quests, sprint results, tables — is
# dumped with --single-transaction (consistent, no locks). Keeps the last 7 dumps here; mini2 pulls
# them hourly into ~/riverside-archive/db and keeps 30 days.
set -euo pipefail
set -a; . /opt/bluffing-valley/.env; set +a
DIR=/var/backups/bluffing-valley
OUT="$DIR/db-$(date -u +%Y%m%d-%H%M).sql.gz"
IGNORE=""
for t in match_replay match_replay_player poker_hand poker_hand_player hand_canonical hand_upload; do IGNORE="$IGNORE --ignore-table=$MYSQL_DATABASE.$t"; done
mysqldump -h"$MYSQL_HOST" -P"${MYSQL_PORT:-3306}" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" \
  --single-transaction --quick --routines --triggers --set-gtid-purged=OFF $IGNORE "$MYSQL_DATABASE" 2>/dev/null | gzip -6 > "$OUT.part"
mv "$OUT.part" "$OUT"
# integrity: the dump must end with the completion marker
if ! gzip -dc "$OUT" | tail -1 | grep -q "Dump completed"; then echo "backup INCOMPLETE: $OUT" >&2; exit 1; fi
ls -1t "$DIR"/db-*.sql.gz | tail -n +8 | xargs -r rm -f
echo "ok $OUT $(stat -c%s "$OUT") bytes"
