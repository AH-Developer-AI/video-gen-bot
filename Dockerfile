FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:1
ENV NODE_WORKDIR=/app
ENV SCREEN_WIDTH=1280
ENV SCREEN_HEIGHT=720
ENV SCREEN_DEPTH=24

# ---- System + Chrome/Puppeteer libs + Desktop + VNC + Python + Node ----
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
      novnc \
      websockify \
      curl \
      # Desktop + VNC
      xfce4 xfce4-goodies tightvncserver dbus-x11 xfonts-base \
      # Python stack
      python3 python3-pip python3-dev build-essential libffi-dev libssl-dev \
      git \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ---- Python deps ----
RUN python3 -m pip install --upgrade pip setuptools wheel
COPY requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir -r /app/requirements.txt

# ---- Node deps (Puppeteer etc.) ----
WORKDIR /app
COPY package.json package-lock.json* /app/
RUN npm install --unsafe-perm --legacy-peer-deps

# ---- App code ----
COPY app /app/app
COPY generate_login_incognito.js /app/
COPY app/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# ---- VNC xstartup (XFCE) ----
RUN mkdir -p /root/.vnc && \
    printf '#!/bin/sh\nunset SESSION_MANAGER\nunset DBUS_SESSION_BUS_ADDRESS\nstartxfce4 &\n' > /root/.vnc/xstartup && \
    chmod +x /root/.vnc/xstartup

# ---- Ports ----
EXPOSE 5901 8000

# ---- CMD ----
CMD ["/app/start.sh"]
