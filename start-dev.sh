#!/bin/bash
# Start both the API server and the web app dev server
echo "Starting DuckCodeModeling..."

# Start API server in background
cd packages/api-server
node index.js &
API_PID=$!
echo "[duckcodemodeling] API server started (PID: $API_PID)"

# Start web app dev server
cd ../web-app
npm run dev &
WEB_PID=$!
echo "[duckcodemodeling] Web app started (PID: $WEB_PID)"

echo ""
echo "  API server:  http://localhost:3001"
echo "  Web app:     http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers."

# Wait and cleanup on exit
trap "kill $API_PID $WEB_PID 2>/dev/null; exit" INT TERM
wait
