#!/bin/zsh
# Remove the voice-*@example.test throwaway users and every row that points at them.
ssh hk 'set -a; . /opt/bluffing-valley/.env; set +a; mysql -h"$MYSQL_HOST" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" 2>&1 <<SQL | grep -v Warning
CREATE TEMPORARY TABLE tmp_ids AS SELECT id FROM user WHERE email LIKE "voice-%@example.test";
DELETE FROM poker_escrow WHERE user_id IN (SELECT id FROM tmp_ids);
DELETE FROM chip_ledger WHERE user_id IN (SELECT id FROM tmp_ids);
DELETE FROM session WHERE user_id IN (SELECT id FROM tmp_ids);
DELETE FROM notification WHERE user_id IN (SELECT id FROM tmp_ids);
DELETE FROM quest_progress WHERE user_id IN (SELECT id FROM tmp_ids);
DELETE FROM user_achievement WHERE user_id IN (SELECT id FROM tmp_ids);
DELETE FROM user_trigram WHERE user_id IN (SELECT id FROM tmp_ids);
DELETE FROM conversation_member WHERE user_id IN (SELECT id FROM tmp_ids);
DELETE FROM match_replay_player WHERE user_id IN (SELECT id FROM tmp_ids);
DELETE FROM poker_hand_player WHERE user_id IN (SELECT id FROM tmp_ids);
DELETE FROM poker_table WHERE created_by IN (SELECT id FROM tmp_ids);
DELETE FROM user WHERE id IN (SELECT id FROM tmp_ids);
SELECT COUNT(*) AS leftover FROM user WHERE email LIKE "voice-%@example.test";
SQL'
