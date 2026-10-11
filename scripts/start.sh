#!/bin/sh
# Start the API on an internal port, wait until healthy, then serve the web app.
# If either process exits, the container exits so the platform restarts it.
set -e
PORT_WEB="${PORT:-3000}"

PORT=4000 node apps/api/dist/server.js &
API_PID=$!

for i in $(seq 1 30); do
  if node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    break
  fi
  sleep 1
done

cd apps/web && node ../../node_modules/next/dist/bin/next start -p "$PORT_WEB" -H 0.0.0.0 &
WEB_PID=$!

trap 'kill $API_PID $WEB_PID 2>/dev/null' TERM INT
# Exit as soon as either child dies.
while kill -0 $API_PID 2>/dev/null && kill -0 $WEB_PID 2>/dev/null; do sleep 2; done
kill $API_PID $WEB_PID 2>/dev/null || true
exit 1
