# ───────── BASE IMAGE ─────────
FROM ubuntu:22.04

# ───────── ENVIRONMENT ─────────
ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:1
ENV SCREEN_WIDTH=1280
ENV SCREEN_HEIGHT=720
ENV SCREEN_DEPTH=24
ENV NODE_WORKDIR=/app

# ───────── SYSTEM + CHROME/PUPPETEER LIBS + NODE 20 ─────────
RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y \
      ca-certificates \
      fonts-liberation \
      libasound2 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libc6 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libexpat1 \
      libfontconfig1 \
      libgcc-s1 \
      libglib2.0-0 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libx11-6 \
      libx11-xcb1 \
      libxcb1 \
      libxcomposite1 \
      libxcursor1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxi6 \
      libxrandr2 \
      libxrender1 \
      libxss1 \
      libxtst6 \
      xdg-utils \
      wget \
      curl \
      xvfb \
      x11vnc \
      fluxbox \
      novnc \
      websockify \
      python3 python3-pip python3-dev build-essential libffi-dev libssl-dev \
      git \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ───────── PYTHON: FASTAPI + UVICORN + DOTENV ─────────
RUN python3 -m pip install --upgrade pip setuptools wheel
COPY requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir -r /app/requirements.txt

# ───────── NODE: PUPPETEER DEPENDENCIES ─────────
WORKDIR /app
COPY package.json package-lock.json* /app/
RUN npm install --unsafe-perm --legacy-peer-deps

# ───────── APP CODE ─────────
COPY app /app/app
COPY generate_login_incognito.js /app/
COPY app/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# ───────── PORTS ─────────
EXPOSE 5900 6080 8000

# ───────── START COMMAND ─────────
CMD ["/app/start.sh"]
