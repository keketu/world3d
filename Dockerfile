FROM node:20-slim

WORKDIR /app

# 先装依赖（workspaces 结构，逐个拷 package.json 以利用缓存）
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm install

# 拷源码并构建前端
COPY . .
RUN npm run build

# HF Spaces 以 uid 1000 运行容器，需要可写的数据库目录
RUN mkdir -p /app/data && chown -R 1000:1000 /app

ENV PORT=7860
EXPOSE 7860

USER 1000
CMD ["npm", "start"]
