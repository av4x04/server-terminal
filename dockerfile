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

# ==============================================================================
# PHẦN ĐỘ CHẾ: CUSTOM TÊN TERMINAL
# Đoạn này sẽ sửa file cấu hình .bashrc để đổi cái prompt (dấu nhắc lệnh)
# \e[1;32m : Màu xanh lá (Green) - Nhìn cho giống Hacker
# root@Hacker-Lỏ : Tên mày muốn hiển thị. Thích đổi tên khác thì sửa ở đây.
# \w : Hiển thị thư mục hiện tại
# ==============================================================================
RUN echo 'export PS1="\e[1;32mroot@Hacker-Lỏ\e[0m:\w\$ "' >> /root/.bashrc

# Set shell mặc định là BASH (quan trọng, vì sh không nhận giao diện đẹp)
ENV SHELL=/bin/bash

# 7. Mở port
ENV PORT=10000
EXPOSE 10000

# 8. Chạy
CMD ["node", "server.js"]
