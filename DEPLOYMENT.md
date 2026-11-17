# 9HR India Private Limited — Production Deployment & Operations Guide

**Target Subdomain:** `https://portal.9hrindia.com`  
**Stack:** React 19 + TypeScript + Vite + Express (`server.ts`) + PostgreSQL (Cloud SQL / Drizzle ORM) + Firebase Auth

---

## 1. Environment Variables

Copy `.env.example` to `.env` and populate strong cryptographic secrets:

- `SESSION_SECRET`: 64-char random hex (`openssl rand -hex 32`)
- `FILE_ENCRYPTION_KEY`: 64-char random hex for AES-256-GCM encrypted document vault
- `DOWNLOAD_TOKEN_SECRET`: 64-char random hex for 120-second signed document download URLs
- `APP_URL`: `https://portal.9hrindia.com`
- Cloud SQL / PostgreSQL Object-Method Variables: `SQL_HOST`, `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD`, `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD`
- Optional SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) for email OTPs, password resets, and onboarding invites

---

## 2. Database Schema Push & Initial Seed

```bash
# Push Drizzle schema to PostgreSQL
npm run db:push

# Optional CLI seed (generates random initial passwords printed once to stdout if env vars unset)
npm run db:seed
```

Alternatively, start the server on an empty database and visit `https://portal.9hrindia.com` to complete the interactive **Initial Enterprise Super Admin Setup**.

---

## 3. Production Build & Docker Deployment

```bash
npm ci
npm run build
NODE_ENV=production npm start
```

Using Docker Compose:
```bash
docker compose up -d --build
```

---

## 4. Subdomain DNS & HTTPS (Nginx Reverse Proxy)

1. Point an `A` or `CNAME` record for `portal.9hrindia.com` to your server/load-balancer IP.
2. Terminate TLS 1.3 with Let's Encrypt (`certbot --nginx -d portal.9hrindia.com`) and proxy to `127.0.0.1:3000`:

```nginx
server {
    listen 443 ssl http2;
    server_name portal.9hrindia.com;

    ssl_certificate /etc/letsencrypt/live/portal.9hrindia.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/portal.9hrindia.com/privkey.pem;
    client_max_body_size 12M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 5. Automated Backup & Restore Procedure

```bash
# Daily encrypted PostgreSQL backup
pg_dump -h "$SQL_HOST" -U "$SQL_ADMIN_USER" -Fc "$SQL_DB_NAME" > "9hr_backup_$(date +%F).dump"

# Archive encrypted candidate document storage alongside DB backup
tar -czf "9hr_docs_$(date +%F).tar.gz" storage/encrypted_docs/

# Restore database
pg_restore -h "$SQL_HOST" -U "$SQL_ADMIN_USER" -d "$SQL_DB_NAME" --clean --if-exists 9hr_backup_YYYY-MM-DD.dump
```
