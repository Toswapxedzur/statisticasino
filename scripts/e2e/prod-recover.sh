#!/bin/zsh
# Prod relay E2E: create 2 throwaway users + sessions on prod, make a table over wss, run the harness, then remove the test users.
S=$(dirname "$0")
NOW=$(( $(date +%s) * 1000 ))
UA=$(node -e 'console.log(require("crypto").randomBytes(16).toString("hex"))'); UB=$(node -e 'console.log(require("crypto").randomBytes(16).toString("hex"))')
TA=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'); TB=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')
HA=$(node -e "console.log(require('crypto').createHash('sha256').update('$TA').digest('hex'))"); HB=$(node -e "console.log(require('crypto').createHash('sha256').update('$TB').digest('hex'))")
ssh hk "set -a; . /opt/bluffing-valley/.env; set +a; mysql -h\"\$MYSQL_HOST\" -u\"\$MYSQL_USER\" -p\"\$MYSQL_PASSWORD\" \"\$MYSQL_DATABASE\" -e \"INSERT INTO user(id,email,display_name,created_at,chips) VALUES('$UA','voice-a-$UA@example.test','VoiceA',$NOW,500),('$UB','voice-b-$UB@example.test','VoiceB',$NOW,500); INSERT INTO session(id,user_id,expires_at) VALUES('$HA','$UA',$((NOW+3600000))),('$HB','$UB',$((NOW+3600000)))\" 2>/dev/null" || { echo "insert failed"; exit 1; }
TABLE=$(node -e '
const [tok]=process.argv.slice(1); const ws=new WebSocket("wss://bluffingvalley.blopybox.net/ws",{headers:{cookie:"casino_session="+tok}});
ws.onopen=()=>{ws.send(JSON.stringify({t:"hello"}));};
ws.onmessage=(m)=>{const d=JSON.parse(m.data); if(d.t==="hello.ok") ws.send(JSON.stringify({t:"table.create",name:"Voice relay test",variant:"holdem",smallBlind:1,bigBlind:2,maxSeats:6,minBuyin:40,maxBuyin:200,buyin:200})); if(d.t==="table.created"){console.log(d.tableId);process.exit(0)} if(d.t==="error"){console.error(d.msg);process.exit(1)}};
ws.onerror=(e)=>{console.error("ws error",e.message);process.exit(3)};
setTimeout(()=>process.exit(2),10000);' "$TA")
echo "table=$TABLE"
pkill -f "data-dir=/tmp/vpro"; rm -rf /tmp/vprofA /tmp/vprofB
node $S/voice-recover.mjs "$TA" "$TB" "$TABLE" https://bluffingvalley.blopybox.net > $S/prod-recover.log 2>&1 &
PID=$!; for i in $(seq 1 52); do sleep 5; kill -0 $PID 2>/dev/null || break; done; kill $PID 2>/dev/null; pkill -f "data-dir=/tmp/vpro"
grep -v "^p[123] t+" $S/prod-recover.log
# cleanup: the two throwaway users, their sessions and the test table's traces
$S/prod-cleanup.sh && echo "test users removed"
