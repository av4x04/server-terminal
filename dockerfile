# 1. Dùng bản Slim (Node v20 có sẵn, cực nhẹ cho Render)
FROM node:20-slim

# 2. Cài đầy đủ đồ chơi (Cấm cắn: python, git, zip, nano, build-essential, nodejs, npm...)
RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs \
    npm \
    python3 \
    python3-pip \
    git \
    zip \
    unzip \
    nano \
    wget \
    curl \
    make \
    g++ \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 3. Set thư mục làm việc
WORKDIR /app

# 4. Copy package.json trước để build cho nhanh
COPY package*.json ./

# 5. Cài node_modules (chế độ production cho đỡ tốn RAM)
RUN npm install --production

# 6. Copy toàn bộ code vào
COPY . .

# 7. Độ tên admin@client màu đỏ rực (Giữ đúng chất chơi của mày)
RUN echo 'export PS1="\e[1;31madmin@client\e[0m:\w\$ "' >> /root/.bashrc

# 8. CẤU HÌNH HỆ THỐNG & ÉP RAM (Lệnh export/ENV xịn nhất 2026)
ENV NODE_OPTIONS="--max-old-space-size=450"
ENV SHELL=/bin/bash
ENV PORT=10000
EXPOSE 10000

# 9. Chạy app (Gọn gàng, không lôi thôi)
CMD ["node", "server.js"]
