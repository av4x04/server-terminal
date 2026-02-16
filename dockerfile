# 1. Dùng bản Slim của Node để tiết kiệm RAM tối đa
FROM node:20-slim

# 2. Cài đống "đồ chơi" mày muốn. 
# Thêm --no-install-recommends để nó không cài mấy thứ rác rưởi đi kèm.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    git \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 3. Set thư mục làm việc
WORKDIR /app

# 4. Copy file package trước để cache, build cho nhanh
COPY package*.json ./
RUN npm install --production

# 5. Copy toàn bộ code vào
COPY . .

# 6. Render nó soi cái Port này
ENV PORT=10000
EXPOSE 10000

# 7. Chạy web terminal của mày
# Nhớ đổi 'index.js' thành file chạy chính của mày nhé con giời
CMD ["node", "index.js"]
