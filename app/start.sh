#!/bin/bash
set -e

export DISPLAY=:1
export USER=root

# Default VNC password agar env me na diya ho
VNC_PASSWORD=${VNC_PASSWORD:-"changeme"}

mkdir -p /root/.vnc

# Agar VNC password file nahi hai, to bana do
if [ ! -f /root/.vnc/passwd ]; then
  echo "Setting VNC password..."
  echo "$VNC_PASSWORD" | vncpasswd -f > /root/.vnc/passwd
  chmod 600 /root/.vnc/passwd
fi

echo "🚀 Starting VNC server on :1 (port 5901)..."
vncserver :1 -geometry ${SCREEN_WIDTH}x${SCREEN_HEIGHT} -depth ${SCREEN_DEPTH}

echo "🚀 Starting FastAPI app..."
cd /app/app
uvicorn main:app --host 0.0.0.0 --port 8000
