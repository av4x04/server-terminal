# 1. Dùng bản Slim cho nhẹ
FROM node:20-slim

# 2. Cài đồ chơi + BẮT BUỘC PHẢI CÓ 'make', 'g++', 'python3' ĐỂ BUILD NODE-PTY
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    git \
    wget \
    curl \
    make \
    g++ \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 3. Set thư mục làm việc
WORKDIR /app

# 4. Copy package.json trước
COPY package*.json ./

# 5. Cài node_modules
# Thằng node-pty rất kén, cần build từ source nên bước này hay lỗi nếu thiếu đồ
RUN npm install --production

# 6. Copy code vào
COPY . .

# 7. Mở port
ENV PORT=10000
EXPOSE 10000

# 8. Chạy
CMD ["node", "server.js"]
