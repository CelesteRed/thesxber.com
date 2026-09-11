#!/usr/bin/env bash
# Prepared for Wings1 (192.168.1.214) only. Existing wg0/Docker are not restarted.
set -euo pipefail
test "$(id -u)" = 0 || { echo 'Run with sudo.' >&2; exit 1; }
test "$(hostname)" = t4ny-ptero-wings-node1
test -f /home/celeste/.sxber-setup/private.key
test ! -e /etc/wireguard/wg-sxber.conf
test ! -e /usr/local/sbin/sxber-routing
test "$(wg show wg0 fwmark)" = 0xca6c
test "$(sysctl -n net.ipv4.ip_forward)" = 1
test "$(sysctl -n net.ipv4.conf.all.rp_filter)" = 2
if ip -4 address | grep -q '10.77.0.'; then echo 'Tunnel subnet already in use.' >&2; exit 1; fi
if ip rule show | grep -Eq '^(89|90|91):|lookup 51821'; then echo 'Policy routing IDs already in use.' >&2; exit 1; fi
test -z "$(ip route show table 51821 2>/dev/null || true)"
if iptables-save | grep -Eq 'SXBER_|0x1000000'; then echo 'Firewall identifiers already in use.' >&2; exit 1; fi
backup="/root/sxber-setup-backup-$(date +%Y%m%d-%H%M%S)"
install -d -m 700 "$backup"
cp -a /etc/wireguard /etc/ufw "$backup/"
iptables-save > "$backup/iptables.before"
nft list ruleset > "$backup/nft.before" 2>/dev/null || true
ip -4 route show table all > "$backup/routes.before"
ip rule > "$backup/ip-rules.before"
wg show > "$backup/wg.before"
umask 077
cat > /etc/wireguard/wg-sxber.conf <<EOF
[Interface]
Address = 10.77.0.2/30
ListenPort = 51821
PrivateKey = $(cat /home/celeste/.sxber-setup/private.key)
Table = off
# Bypass wg0 for this tunnel's encrypted outer packets.
FwMark = 51820
PostUp = /usr/local/sbin/sxber-routing up
PreDown = /usr/local/sbin/sxber-routing down

[Peer]
PublicKey = eUAe3B2dLUMlT59L/XUhjw5vzflnTmWTk3K+EGgv9Ho=
Endpoint = 83.147.217.242:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
EOF
chmod 600 /etc/wireguard/wg-sxber.conf
cat > /usr/local/sbin/sxber-routing <<'SXBER_HOOK'
#!/usr/bin/env bash
# Routes only Sxber connections through the new tunnel.
set -euo pipefail
IFACE=wg-sxber
MARK=0x01000000/0x01000000
delete_rule() {
    local table=$1 chain=$2
    shift 2
    if iptables -w -t "$table" -C "$chain" "$@" 2>/dev/null; then
        iptables -w -t "$table" -D "$chain" "$@"
    fi
}
down() {
    delete_rule mangle PREROUTING -j SXBER_MARK
    delete_rule mangle OUTPUT -j SXBER_MARK
    delete_rule mangle FORWARD -j SXBER_MSS
    delete_rule filter INPUT -i "$IFACE" -j SXBER_IN
    delete_rule filter FORWARD -i "$IFACE" -j SXBER_IN
    delete_rule filter FORWARD -o "$IFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
    for entry in mangle:SXBER_MARK mangle:SXBER_MSS filter:SXBER_IN; do
        local table=${entry%:*} chain=${entry#*:}
        if iptables -w -t "$table" -S "$chain" >/dev/null 2>&1; then
            iptables -w -t "$table" -F "$chain"
            iptables -w -t "$table" -X "$chain"
        fi
    done
    ip rule del pref 89 iif "$IFACE" lookup main 2>/dev/null || true
    ip rule del pref 90 fwmark "$MARK" lookup 51821 2>/dev/null || true
    ip rule del pref 91 from 10.77.0.2/32 lookup 51821 2>/dev/null || true
    ip route del default dev "$IFACE" table 51821 2>/dev/null || true
}
case "${1:-}" in
down) down; exit 0 ;;
up) ;;
*) echo 'Usage: sxber-routing up|down' >&2; exit 2 ;;
esac
# wg-quick can invoke up again after a failed start.
down
trap 'down' ERR
sysctl -qw net.ipv4.conf.wg-sxber.rp_filter=2
ip route add default dev "$IFACE" table 51821
# Inbound packets use the main table to reach Docker even if wg0 restores
# the UDP connection mark. Replies use the separate Sxber routing table.
ip rule add pref 89 iif "$IFACE" lookup main
ip rule add pref 90 fwmark "$MARK" lookup 51821
ip rule add pref 91 from 10.77.0.2/32 lookup 51821

iptables -w -t mangle -N SXBER_MARK
iptables -w -t mangle -A SXBER_MARK -i "$IFACE" -m conntrack --ctdir ORIGINAL -j CONNMARK --set-xmark "$MARK"
iptables -w -t mangle -A SXBER_MARK -m conntrack --ctdir REPLY -m connmark --mark "$MARK" -j CONNMARK --restore-mark --nfmask 0x01000000 --ctmask 0x01000000
iptables -w -t mangle -A PREROUTING -j SXBER_MARK
iptables -w -t mangle -A OUTPUT -j SXBER_MARK
iptables -w -t mangle -N SXBER_MSS
iptables -w -t mangle -A SXBER_MSS -i "$IFACE" -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
iptables -w -t mangle -A SXBER_MSS -o "$IFACE" -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
iptables -w -t mangle -A FORWARD -j SXBER_MSS

iptables -w -N SXBER_IN
iptables -w -A SXBER_IN -m conntrack --ctstate INVALID -j DROP
iptables -w -A SXBER_IN -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
iptables -w -A SXBER_IN -d 10.77.0.2 -p icmp -j ACCEPT
# Match pre-Docker destination ports so remapped container ports also work.
for proto in tcp udp; do
    for port in 19132 20030:20099 21130:25599 26630:29969 40030:40099 41130:45599 46630:49969; do
        iptables -w -A SXBER_IN -p "$proto" -m conntrack --ctorigdst 10.77.0.2 --ctorigdstport "$port" -j ACCEPT
    done
done
iptables -w -A SXBER_IN -j DROP
iptables -w -I INPUT 1 -i "$IFACE" -j SXBER_IN
iptables -w -I FORWARD 1 -i "$IFACE" -j SXBER_IN
iptables -w -I FORWARD 1 -o "$IFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
trap - ERR
SXBER_HOOK
chmod 700 /usr/local/sbin/sxber-routing
install -d -m 755 /etc/systemd/system/wg-quick@wg-sxber.service.d
cat > /etc/systemd/system/wg-quick@wg-sxber.service.d/ordering.conf <<'EOF'
[Unit]
After=wg-quick@wg0.service docker.service ufw.service
EOF
chmod 644 /etc/systemd/system/wg-quick@wg-sxber.service.d/ordering.conf
systemctl daemon-reload
if ! systemctl enable --now wg-quick@wg-sxber; then
    systemctl disable --now wg-quick@wg-sxber || true
    /usr/local/sbin/sxber-routing down || true
    echo "Tunnel start failed; existing networking untouched. Backup: $backup" >&2
    exit 1
fi
ping -c 3 -W 3 -I 10.77.0.2 10.77.0.1
wg show wg-sxber
ip rule
ip route get 1.1.1.1 mark 0x01000000
ip route get 83.147.217.242 mark 51820
echo "Wings1 tunnel installed. Backup: $backup"
echo 'External TCP/UDP and real-player-IP verification is still required.'
