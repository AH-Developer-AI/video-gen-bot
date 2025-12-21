# Python 3.10 Slim Base Image
FROM python:3.10-slim

# Environment Variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable \
    NODE_WORKDIR=/app

# Working Directory
WORKDIR /app

# 1. Install System Dependencies (Chrome, Node.js, Xvfb)
RUN apt-get update && apt-get install -y \
    wget gnupg curl unzip xvfb \
    fonts-liberation libasound2 libatk-bridge2.0-0 \
    libgtk-3-0 libnss3 libxss1 xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 2. Install Google Chrome Stable
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 3. Install Node.js (v18)
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs

# 4. Install Python Dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 5. Install Node Dependencies
COPY package.json .
RUN npm install

# 6. Copy All Code
COPY . .

# 7. Create Directories
RUN mkdir -p /app/gemini_prompts /app/output /app/jobs

# 8. Expose Port
EXPOSE 8000

# 9. Start Command
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
