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
    libpq-dev libxml2-dev libxslt1-dev zlib1g-dev \
    wget curl unzip git \
    xvfb x11vnc fluxbox novnc websockify \
    nodejs npm \
    && rm -rf /var/lib/apt/lists/*

# ───────── UPGRADE PIP & INSTALL WHEEL ─────────
RUN python3 -m pip install --upgrade pip setuptools wheel

# ───────── WORKDIR ─────────
WORKDIR /app

# ───────── COPY APP FILES ─────────
COPY ./app /app

# ───────── INSTALL PYTHON DEPENDENCIES ─────────
RUN pip install --no-cache-dir -r requirements.txt

# ───────── INSTALL NODE DEPENDENCIES ─────────
RUN npm install

# ───────── MAKE START SCRIPT EXECUTABLE ─────────
RUN chmod +x start.sh

# ───────── EXPOSE PORTS ─────────
EXPOSE 5900 6080 8000

# ───────── START COMMAND ─────────
CMD ["./start.sh"]
