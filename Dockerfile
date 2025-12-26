FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:1
ENV SCREEN_WIDTH=1280
ENV SCREEN_HEIGHT=720
ENV SCREEN_DEPTH=24

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-dev \
    nodejs npm \
    wget curl unzip \
    xvfb x11vnc fluxbox \
    novnc websockify \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy project files
COPY . /app

# Install Python dependencies
RUN pip3 install --no-cache-dir -r requirements.txt

# Install Node dependencies
RUN npm install

# Make start script executable
RUN chmod +x start.sh

# Expose ports
EXPOSE 5900 6080 8000

# Start container
CMD ["./start.sh"]
