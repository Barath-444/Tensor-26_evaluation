#!/bin/bash
# start.sh — Start both backend and frontend

echo "Starting TENSOR-26 Evaluation System..."

# Start backend
echo "Starting backend on port 3001..."
cd backend && npm install --silent && node server.js &
BACKEND_PID=$!

# Wait for backend
sleep 2

# Start frontend
echo "Starting frontend on port 3000..."
cd ../frontend && npm install --silent && npm start &
FRONTEND_PID=$!

echo ""
echo "TENSOR-26 Evaluator running!"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop both."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT
wait
