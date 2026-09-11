#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
test -f /root/sxber-setup-backup/iptables.before
test ! -e /etc/wireguard/wg-sxber.conf
cat > /etc/wireguard/wg-sxber.conf <<EOF
[Interface]
Address = 10.77.0.1/30
ListenPort = 51820
PrivateKey = $(cat /etc/wireguard/sxber.key)

[Peer]
PublicKey = jA0wWO6GAXkVUqasOwjoogL+5ZAQzEa4jONDsf/C034=
AllowedIPs = 10.77.0.2/32
EOF
chmod 600 /etc/wireguard/wg-sxber.conf

cat > /etc/sysctl.d/99-sxber-network.conf <<'EOF'
# Match the existing VPS forwarding and source-validation behavior.
net.ipv4.ip_forward = 1
net.ipv4.conf.all.rp_filter = 2
net.ipv4.conf.default.rp_filter = 2
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
EOF
sysctl -p /etc/sysctl.d/99-sxber-network.conf

cat > /etc/sysctl.d/99-zz-ipv4-only.conf <<'EOF'
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
net.ipv6.conf.lo.disable_ipv6 = 1
EOF
sysctl -p /etc/sysctl.d/99-zz-ipv4-only.conf
sed -i 's/^IPV6=.*/IPV6=no/' /etc/default/ufw

python3 - <<'PY'
from pathlib import Path
path = Path('/etc/ufw/before.rules')
original = path.read_text()
assert '*nat' not in original and '*mangle' not in original
ports = ['19132', '20030:20099', '21130:25599', '26630:29969', '40030:40099', '41130:45599', '46630:49969']
rules = ['# Sxber game forwarding. Never DNAT ports 80, 443 or SSH 6767.', '*nat', ':PREROUTING ACCEPT [0:0]', ':POSTROUTING ACCEPT [0:0]']
for proto, ranges in [('tcp', ports), ('udp', ports)]:
    for port in ranges:
        rules.append(f'-A PREROUTING -i ens3 -d 83.147.217.242 -p {proto} --dport {port} -j DNAT --to-destination 10.77.0.2')
rules += ['# Only tunnel-originated outbound traffic is masqueraded; inbound player IPs stay intact.', '-A POSTROUTING -s 10.77.0.0/30 -o ens3 -j MASQUERADE', 'COMMIT', '*mangle', ':FORWARD ACCEPT [0:0]', '-A FORWARD -o wg-sxber -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu', '-A FORWARD -i wg-sxber -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu', 'COMMIT', '']
path.write_text('\n'.join(rules) + original)
PY
iptables-restore --test < /etc/ufw/before.rules

ufw allow 6767/tcp comment 'Sxber SSH'
ufw allow 51820/udp comment 'Sxber WireGuard'
ufw allow 80/tcp comment 'Website HTTP'
ufw allow 443/tcp comment 'Website HTTPS'
for port in 19132 20030:20099 21130:25599 26630:29969 40030:40099 41130:45599 46630:49969; do
    ufw allow "$port/tcp" comment 'Game TCP same ranges as main VPS'
    ufw allow "$port/udp" comment 'Game UDP same ranges as main VPS'
done
ufw route allow in on ens3 out on wg-sxber to 10.77.0.2 comment 'Public DNAT to Wings1'
ufw route allow in on wg-sxber out on ens3 from 10.77.0.2 comment 'Wings1 outbound'
ufw default deny incoming
ufw default allow outgoing
ufw default deny routed
ufw logging low
ufw --force enable
systemctl enable --now wg-quick@wg-sxber

cp -a /etc/nginx /root/sxber-setup-backup/nginx
install -d -m 755 /var/www/thesxber /var/www/letsencrypt
cat > /var/www/thesxber/maintenance.html <<'EOF'
<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sxber</title><body><h1>Sxber</h1><p>The site is being set up. Check back soon.</p></body></html>
EOF
cat > /etc/nginx/sites-available/thesxber <<'EOF'
server {
    listen 80 default_server;
    server_name thesxber.com www.thesxber.com 83.147.217.242;
    server_tokens off;
    client_max_body_size 16m;
    access_log /var/log/nginx/thesxber.access.log;
    error_log /var/log/nginx/thesxber.error.log;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
    }

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_intercept_errors on;
        error_page 502 504 =503 /maintenance.html;
    }

    location = /maintenance.html {
        internal;
        root /var/www/thesxber;
        add_header Retry-After 3600 always;
    }
}

# Reserve HTTPS for Nginx until a domain certificate is installed.
# Replace this block with the domain TLS configuration after DNS cutover.
server {
    listen 443 ssl default_server;
    ssl_reject_handshake on;
    server_name _;
}
EOF
if test -L /etc/nginx/sites-enabled/default; then unlink /etc/nginx/sites-enabled/default; fi
ln -s /etc/nginx/sites-available/thesxber /etc/nginx/sites-enabled/thesxber
nginx -t
systemctl enable nginx
systemctl reload nginx
wg show wg-sxber
ufw status verbose
