# Voice E2E (headless Chrome x2, fake mics). Local: run-recover.sh (needs the dev server on 5273 + local test users). Prod relay check: prod-recover.sh (creates + removes voice-*@example.test users on hk). Never invoke from a shell command line that itself contains the pkill pattern.
#!/bin/zsh
# Mint two local sessions, create a fresh holdem table, run the voice recovery E2E. Args: [BASE]
cd /Users/fengyue.john.zhu/Desktop/programme/web/casin/statisticasino
set -a; . ./.env; set +a
S=$(dirname "$0")
mint() { T=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'); H=$(node -e "console.log(require('crypto').createHash('sha256').update('$T').digest('hex'))"); mysql -h"$MYSQL_HOST" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "INSERT INTO session(id,user_id,expires_at) VALUES('$H','$1',$(( $(date +%s) * 1000 + 3600000 )))" 2>/dev/null; echo $T; }
TA=$(mint 188d8e162da5b1103cd0930452b881e0); TB=$(mint 398027827135a9d757ecc356e8abe8cf)
TABLE=$(node -e '
const [tok]=process.argv.slice(1); const ws=new WebSocket("ws://localhost:5273/ws",{headers:{cookie:"casino_session="+tok}});
ws.onopen=()=>{ws.send(JSON.stringify({t:"hello"}));};
ws.onmessage=(m)=>{const d=JSON.parse(m.data); if(d.t==="hello.ok") ws.send(JSON.stringify({t:"table.create",name:"Voice recover",variant:"holdem",smallBlind:1,bigBlind:2,maxSeats:6,minBuyin:40,maxBuyin:200,buyin:200})); if(d.t==="table.created"){console.log(d.tableId);process.exit(0)} if(d.t==="error"){console.error(d.msg);process.exit(1)}};
setTimeout(()=>process.exit(2),8000);' "$TA")
echo "table=$TABLE"
curl -s -o /dev/null -w "table page: %{http_code}\n" -b "casino_session=$TA" "http://localhost:5273/table/$TABLE"
pkill -f "data-dir=/tmp/vpro"; rm -rf /tmp/vprofA /tmp/vprofB
node $S/voice-recover.mjs "$TA" "$TB" "$TABLE" > $S/recover.log 2>&1 &
PID=$!; for i in $(seq 1 52); do sleep 5; kill -0 $PID 2>/dev/null || break; done; kill $PID 2>/dev/null; pkill -f "data-dir=/tmp/vpro"
cat $S/recover.log
