#!/bin/bash
set -e

echo "🚀 Starting Xvfb..."
Xvfb :1 -screen 0 ${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH} &

echo "🚀 Starting fluxbox window manager..."
fluxbox &

echo "🚀 Starting x11vnc..."
x11vnc -display :1 -nopw -forever -shared &

echo "🚀 Starting noVNC web interface..."
/usr/share/novnc/utils/launch.sh --vnc localhost:5900 &

echo "🚀 Starting FastAPI app..."
cd /app/app
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
