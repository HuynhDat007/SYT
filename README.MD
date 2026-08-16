# Hướng dẫn triển khai Docker - SYT Health Check

### 1. Build & Push Image lên Docker Hub
```bash
# Build image với tag
docker build -t dathtlan/syt-health-check:latest .

# Push lên Docker Hub
docker push dathtlan/syt-health-check:latest
```

### 2. Kéo về và chạy trên Server / VPS bất kỳ
```bash
# Kéo image mới nhất từ Docker Hub
docker pull dathtlan/syt-health-check:latest

# Chạy container trực tiếp
docker run -d \
  --name syt-health-check \
  -p 3000:3000 \
  --env-file .env \
  --restart unless-stopped \
  dathtlan/syt-health-check:latest
```

### 3. Hoặc chạy với Docker Compose
```bash
docker compose up -d
```

http://hub1.vnpt.me/api/deploy/3ccab081faa3cb34319d8f703992d476124c66f62745b53d