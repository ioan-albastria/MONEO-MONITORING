# Deployment Guide

## Pre-Deployment Checklist

- [ ] All environment variables configured
- [ ] Database migrations applied
- [ ] SSL/TLS certificates obtained
- [ ] CORS allowed origins configured
- [ ] Backend tests passing
- [ ] Frontend build succeeds
- [ ] Docker images building without errors
- [ ] Monitoring and logging configured
- [ ] Backup strategy implemented
- [ ] Load balancer configured (if applicable)

---

## Local Development Deployment

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL 14+
- Git

### Setup Steps

#### 1. Clone Repository
```bash
git clone <repository-url>
cd MONEO-MONITORING
```

#### 2. Backend Setup
```bash
cd backend

# Create virtual environment
python -m venv .venv
.venv\Scripts\activate  # Windows
# or source .venv/bin/activate  # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Create .env file
cp .env.example .env

# Edit .env with local settings:
# DATABASE_URL=postgresql://moneo_user:password@localhost/moneo_monitoring
# MONEO_API_KEY=your_test_api_key
# JWT_SECRET_KEY=your_secret_key

# Run database migrations
# (If using Alembic)
alembic upgrade head

# Or initialize database
python -c "from DAL import init_db; init_db()"

# Start backend server
uvicorn main:app --reload --port 8000
```

#### 3. Frontend Setup
```bash
cd frontend

# Install dependencies
npm install

# Start development server
ng serve

# Application accessible at: http://localhost:4200
```

#### 4. Access Application
- **Frontend**: http://localhost:4200
- **Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs

---

## Docker Deployment

### Docker Compose (Recommended for Development/Staging)

#### 1. Create docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: moneo_user
      POSTGRES_PASSWORD: secure_password
      POSTGRES_DB: moneo_monitoring
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U moneo_user"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    environment:
      DATABASE_URL: postgresql://moneo_user:secure_password@postgres:5432/moneo_monitoring
      REDIS_URL: redis://redis:6379
      MONEO_API_KEY: ${MONEO_API_KEY}
      JWT_SECRET_KEY: ${JWT_SECRET_KEY}
      DEBUG: "false"
    ports:
      - "8000:8000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - ./backend:/app
    command: uvicorn main:app --host 0.0.0.0 --port 8000

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        API_URL: http://localhost:8000
    ports:
      - "4200:4200"
    depends_on:
      - backend
    environment:
      API_URL: http://backend:8000

volumes:
  postgres_data:
```

#### 2. Create Backend Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

#### 3. Create Frontend Dockerfile

```dockerfile
# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG API_URL=http://localhost:8000
ENV API_URL=${API_URL}

RUN ng build --configuration production

# Runtime stage
FROM nginx:alpine

COPY --from=builder /app/dist/esp-32-control-center/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

#### 4. Create nginx.conf

```nginx
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    gzip on;
    gzip_vary on;
    gzip_min_length 1000;
    gzip_types text/plain text/css text/xml text/javascript 
               application/x-javascript application/xml+rss;

    server {
        listen 80;
        server_name _;

        root /usr/share/nginx/html;
        index index.html;

        # API proxy
        location /api {
            proxy_pass http://backend:8000/api;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # WebSocket support
        location /ws {
            proxy_pass http://backend:8000/ws;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
        }

        # Angular routing
        location / {
            try_files $uri $uri/ /index.html;
        }

        # Cache busting for assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
}
```

#### 5. Run Docker Compose

```bash
# Create .env file with credentials
cat > .env << EOF
MONEO_API_KEY=your_api_key
JWT_SECRET_KEY=your_secret_key
EOF

# Start services
docker-compose up -d

# View logs
docker-compose logs -f backend

# Stop services
docker-compose down

# Reset database
docker-compose down -v  # Remove volumes
docker-compose up -d
```

---

## Production Deployment

### Using Kubernetes

#### 1. Create Namespace

```bash
kubectl create namespace moneo
```

#### 2. Configure Secrets

```bash
kubectl create secret generic moneo-secrets \
  --from-literal=db-password=secure_password \
  --from-literal=moneo-api-key=your_api_key \
  --from-literal=jwt-secret-key=your_secret_key \
  -n moneo
```

#### 3. PostgreSQL StatefulSet

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: moneo
spec:
  serviceName: postgres
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: postgres:15-alpine
        ports:
        - containerPort: 5432
        env:
        - name: POSTGRES_USER
          value: moneo_user
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: moneo-secrets
              key: db-password
        - name: POSTGRES_DB
          value: moneo_monitoring
        volumeMounts:
        - name: postgres-storage
          mountPath: /var/lib/postgresql/data
        livenessProbe:
          exec:
            command:
            - /bin/sh
            - -c
            - pg_isready -U moneo_user
          initialDelaySeconds: 30
          periodSeconds: 10
  volumeClaimTemplates:
  - metadata:
      name: postgres-storage
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 50Gi
```

#### 4. Backend Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: moneo
spec:
  replicas: 3
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
      - name: backend
        image: moneo/backend:latest
        imagePullPolicy: Always
        ports:
        - containerPort: 8000
        env:
        - name: DATABASE_URL
          value: postgresql://moneo_user:$(DB_PASSWORD)@postgres:5432/moneo_monitoring
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: moneo-secrets
              key: db-password
        - name: MONEO_API_KEY
          valueFrom:
            secretKeyRef:
              name: moneo-secrets
              key: moneo-api-key
        - name: JWT_SECRET_KEY
          valueFrom:
            secretKeyRef:
              name: moneo-secrets
              key: jwt-secret-key
        - name: DEBUG
          value: "false"
        livenessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 10
          periodSeconds: 5
        resources:
          requests:
            cpu: "250m"
            memory: "256Mi"
          limits:
            cpu: "500m"
            memory: "512Mi"
```

#### 5. Frontend Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: moneo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
      - name: frontend
        image: moneo/frontend:latest
        imagePullPolicy: Always
        ports:
        - containerPort: 80
        livenessProbe:
          httpGet:
            path: /
            port: 80
          initialDelaySeconds: 10
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /
            port: 80
          initialDelaySeconds: 5
          periodSeconds: 5
        resources:
          requests:
            cpu: "100m"
            memory: "128Mi"
          limits:
            cpu: "250m"
            memory: "256Mi"
```

#### 6. Services

```yaml
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: moneo
spec:
  clusterIP: None
  selector:
    app: postgres
  ports:
  - port: 5432
    targetPort: 5432

---
apiVersion: v1
kind: Service
metadata:
  name: backend
  namespace: moneo
spec:
  type: ClusterIP
  selector:
    app: backend
  ports:
  - port: 8000
    targetPort: 8000

---
apiVersion: v1
kind: Service
metadata:
  name: frontend
  namespace: moneo
spec:
  type: LoadBalancer
  selector:
    app: frontend
  ports:
  - port: 80
    targetPort: 80
```

#### 7. Deploy to Kubernetes

```bash
# Create namespace and secrets
kubectl create namespace moneo
kubectl create secret generic moneo-secrets \
  --from-literal=db-password=secure_password \
  --from-literal=moneo-api-key=your_api_key \
  --from-literal=jwt-secret-key=your_secret_key \
  -n moneo

# Apply configurations
kubectl apply -f postgres-statefulset.yaml
kubectl apply -f backend-deployment.yaml
kubectl apply -f frontend-deployment.yaml
kubectl apply -f services.yaml

# Check status
kubectl get pods -n moneo
kubectl get svc -n moneo

# View logs
kubectl logs -n moneo -l app=backend -f
```

---

## SSL/TLS Configuration

### Let's Encrypt with Certbot

```bash
# Install Certbot
sudo apt-get install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot certonly --standalone -d api.moneo-monitoring.com

# Auto-renewal
sudo certbot renew --dry-run

# Configure NGINX
server {
    listen 443 ssl;
    server_name api.moneo-monitoring.com;
    
    ssl_certificate /etc/letsencrypt/live/api.moneo-monitoring.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.moneo-monitoring.com/privkey.pem;
    
    # ... rest of configuration
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name api.moneo-monitoring.com;
    return 301 https://$server_name$request_uri;
}
```

---

## Monitoring & Logging

### Application Health Check

```python
# backend/main.py
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc)
    }
```

### Prometheus Metrics

```python
# Install prometheus_client
pip install prometheus-client

# Add to main.py
from prometheus_client import Counter, Histogram, generate_latest
import time

request_duration = Histogram('request_duration_seconds', 'Request duration')
requests_total = Counter('requests_total', 'Total requests')

@app.middleware("http")
async def add_prometheus_middleware(request, call_next):
    start_time = time.time()
    response = await call_next(request)
    duration = time.time() - start_time
    
    request_duration.observe(duration)
    requests_total.inc()
    
    return response

@app.get("/metrics")
async def metrics():
    return generate_latest()
```

### Structured Logging

```python
# Configure Python logging
import logging
import json

class JSONFormatter(logging.Formatter):
    def format(self, record):
        log_data = {
            "timestamp": record.created,
            "level": record.levelname,
            "message": record.getMessage(),
            "logger": record.name
        }
        return json.dumps(log_data)

handler = logging.StreamHandler()
handler.setFormatter(JSONFormatter())
logging.getLogger().addHandler(handler)
logging.getLogger().setLevel(logging.INFO)
```

---

## Backup & Recovery

### PostgreSQL Backup

```bash
# Full backup
pg_dump -U moneo_user -h localhost moneo_monitoring > backup_$(date +%Y%m%d).sql

# Backup with compression
pg_dump -U moneo_user -h localhost -F c moneo_monitoring > backup_$(date +%Y%m%d).dump

# Automated daily backup (cron)
0 2 * * * pg_dump -U moneo_user -h localhost moneo_monitoring | gzip > /backups/moneo_$(date +\%Y\%m\%d).sql.gz

# Restore
psql -U moneo_user -h localhost moneo_monitoring < backup_20240120.sql
pg_restore -U moneo_user -h localhost -d moneo_monitoring backup_20240120.dump
```

### Restore from Backup

```bash
# Create new database
createdb -U moneo_user moneo_monitoring_restored

# Restore data
pg_restore -U moneo_user -d moneo_monitoring_restored backup_20240120.dump

# Verify
psql -U moneo_user -d moneo_monitoring_restored -c "SELECT COUNT(*) FROM dashboards;"
```

---

## Performance Tuning

### PostgreSQL Configuration

```ini
# /etc/postgresql/15/main/postgresql.conf

# Memory
shared_buffers = 256MB          # 25% of RAM
effective_cache_size = 1GB      # 50-75% of RAM
work_mem = 4MB

# Connections
max_connections = 100
superuser_reserved_connections = 3

# WAL (Write-Ahead Log)
wal_buffers = 16MB
max_wal_size = 2GB

# Query Planning
random_page_cost = 1.1
effective_io_concurrency = 200
```

### Connection Pooling with PgBouncer

```ini
# pgbouncer.ini
[databases]
moneo_monitoring = host=localhost port=5432 dbname=moneo_monitoring

[pgbouncer]
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 25
min_pool_size = 10
reserve_pool_size = 5
server_lifetime = 3600
```

---

## Troubleshooting

### Common Issues

#### 1. Database Connection Error
```
Error: could not translate host name "postgres" to address
Solution: Check database service is running, verify hostname in connection string
```

#### 2. JWT Token Expired
```
Error: Token has expired
Solution: Refresh token endpoint, adjust JWT_EXPIRY settings
```

#### 3. MONEO API Connection Fails
```
Error: Failed to connect to MONEO API
Solution: Check API key, verify API endpoint URL, check network connectivity
```

#### 4. High Memory Usage
```
Solution: 
- Check for memory leaks in background jobs
- Monitor query performance
- Increase PostgreSQL effective_cache_size
- Enable query caching with Redis
```

---

## Rollback Procedure

```bash
# If deployment fails

# Kubernetes
kubectl rollout undo deployment/backend -n moneo

# Docker Compose
docker-compose down
git checkout previous-working-version
docker-compose up -d

# Database (if schema migration failed)
psql -U moneo_user moneo_monitoring < backup_before_migration.sql
```

---

## Post-Deployment Checklist

- [ ] Health checks passing
- [ ] Database migrations completed
- [ ] Sensor polling scheduler running
- [ ] Monitoring alerts configured
- [ ] Backup jobs scheduled and tested
- [ ] SSL certificate valid
- [ ] CORS working correctly
- [ ] Error logs empty (or only expected warnings)
- [ ] Performance metrics within acceptable range
- [ ] User acceptance testing completed

