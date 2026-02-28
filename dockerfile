# 1. Dùng bản Slim (Node v20)
FROM node:20-slim

# 2. Cài đồ chơi (Cấm cắn: python, git, zip, nano, build-essential, nodejs, npm...)
# Đoạn này chạy LÚC BUILD để có sẵn đồ dùng
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

# 4. Copy package.json trước
COPY package*.json ./

# 5. Cài node_modules
RUN npm install --production

# 6. Copy code vào
COPY . .

# 7. ĐỘ MÀU ĐỎ + TỰ ĐỘNG UPDATE KHI VÀO SHELL
# Tao nhét thêm lệnh 'apt update' vào đây, mỗi lần mày mở Terminal trên Render là nó tự chạy
RUN echo 'apt update' >> /root/.bashrc && \
    echo 'export PS1="\e[1;31madmin@client\e[0m:\w\$ "' >> /root/.bashrc

# 8. ÉP RAM 450MB (Xịn nhất 2026)
ENV NODE_OPTIONS="--max-old-space-size=450"
ENV SHELL=/bin/bash
ENV PORT=10000
EXPOSE 10000

# 9. Chạy app
CMD ["node", "server.js"]
