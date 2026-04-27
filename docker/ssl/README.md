# SSL Certificates (Optional)

By default RECON_APP runs on **HTTP only** (port 8080). This is intentional — the app is designed for private networks and VPN access where TLS termination is typically handled upstream.

## Enabling HTTPS

If you need TLS directly on the container (no reverse proxy), follow these steps.

### 1. Generate or copy your certificates

**Self-signed (dev/testing):**
```bash
openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -keyout docker/ssl/key.pem \
  -out docker/ssl/cert.pem \
  -subj "/CN=your-server-ip"
```

**Let's Encrypt (production):**
```bash
cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem docker/ssl/cert.pem
cp /etc/letsencrypt/live/yourdomain.com/privkey.pem docker/ssl/key.pem
```

### 2. Update nginx.conf

In `docker/nginx.conf`, change:
```nginx
server {
    listen 80;
```
to:
```nginx
server {
    listen 80;
    listen 443 ssl;

    ssl_certificate     /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
```

### 3. Update docker-compose.yml

Add the port and volume mount to the `frontend` service:
```yaml
ports:
  - "8080:80"
  - "8443:443"
volumes:
  - ./docker/ssl:/etc/nginx/ssl:ro
```

> Using a bind mount instead of baking certs into the image means you can rotate certs without rebuilding.

### 4. Rebuild and restart

```bash
docker compose up -d --build
```

App now available on `https://your-server:8443`.

---

**cert.pem and key.pem are gitignored** — never commit private keys.
