# Base image
FROM python:3.10-slim

# Environment Variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable \
    NODE_WORKDIR=/app

WORKDIR /app

# 1. Install System Dependencies (wget, curl, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    curl \
    gnupg \
    unzip \
    xvfb \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libxss1 \
    libgbm1 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# 2. Install Google Chrome Stable (NEW METHOD: Direct .deb)
# Hum 'apt-key' use nahi kar rahe, hum seedha file download kar rahe hain.
RUN wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get update \
    && apt-get install -y ./google-chrome-stable_current_amd64.deb \
    && rm google-chrome-stable_current_amd64.deb

# 3. Install Node.js (v18)
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs

# 4. Python Dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 5. Node Dependencies
COPY package.json .
RUN npm install

# 6. Copy Code
COPY . .

# 7. Create Directories & Permissions
RUN mkdir -p /app/gemini_prompts /app/output /app/jobs && \
    chmod -R 777 /app/output /app/jobs /app/gemini_prompts

# 8. Start
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "serene-expert", "--port", "8000"]
