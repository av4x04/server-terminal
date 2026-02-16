# 1. Dùng bản Slim (Đã có sẵn Node.js v20, ĐỪNG cài thêm node nữa)
FROM node:20-slim

# 2. Cài đồ chơi (Tao đã bỏ chữ 'node' gây lỗi và giữ lại zip, unzip, nano)
RUN apt-get update && apt-get install -y --no-install-recommends \
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

# 4. Copy package.json trước
COPY package*.json ./

# 5. Cài node_modules
RUN npm install --production

# 6. Copy code vào
COPY . .

# 7. Độ tên admin@client màu đỏ rực
RUN echo 'export PS1="\e[1;31madmin@client\e[0m:\w\$ "' >> /root/.bashrc

# Set shell mặc định là BASH
ENV SHELL=/bin/bash

# 8. Mở port
ENV PORT=10000
EXPOSE 10000

# 9. Chạy (Đã thêm giới hạn RAM cho mày sống sót)
CMD ["node", "--max-old-space-size=450", "server.js"]


