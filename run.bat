@echo off
echo Stopping any existing processes on ports 3000 and 3001...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul

echo Starting Backend...
start cmd /k "cd backend && npm install && node server.js"

echo Waiting for backend to initialize...
timeout /t 3 /nobreak >nul

echo Starting Frontend...
start cmd /k "cd frontend && npm install && npm start"

echo.
echo TENSOR-26 System Launching!
echo Backend: http://localhost:3001
echo Frontend: http://localhost:3000
echo.
pause
