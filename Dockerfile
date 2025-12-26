# ───────── BASE IMAGE ─────────
FROM ubuntu:22.04

# ───────── ENVIRONMENT ─────────
ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:1
ENV SCREEN_WIDTH=1280
ENV SCREEN_HEIGHT=720
ENV SCREEN_DEPTH=24
ENV NODE_WORKDIR=/app

# ───────── SYSTEM DEPENDENCIES ─────────
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-dev build-essential libffi-dev libssl-dev \
    nodejs npm \
    wget curl unzip git \
    xvfb x11vnc fluxbox \
    novnc websockify \
    && rm -rf /var/lib/apt/lists/*

# ───────── UPGRADE PIP & INSTALL WHEEL ─────────
RUN python3 -m pip install --upgrade pip setuptools wheel

# ───────── WORKDIR ─────────
WORKDIR /app

# ───────── COPY AND INSTALL PYTHON DEPENDENCIES ─────────
COPY requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir -r requirements.txt

# ───────── COPY APP CODE ─────────
COPY app /app/app

# ───────── COPY NODE FILES AND INSTALL DEPENDENCIES ─────────
COPY package.json package-lock.json* /app/
RUN npm install --unsafe-perm --legacy-peer-deps

# ───────── COPY GENERATOR SCRIPT ─────────
COPY generate_login_incognito.js /app/

# ───────── COPY START SCRIPT ─────────
COPY app/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# ───────── EXPOSE PORTS ─────────
# 5900 = raw VNC, 6080 = noVNC, 8000 = FastAPI
EXPOSE 5900 6080 8000

# ───────── START COMMAND ─────────
CMD ["/app/start.sh"]
