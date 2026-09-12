# Sxber infrastructure handoff

Historical setup notes from 2026-09-11. The v2 site has since been deployed with Docker Compose; website setup states below describe the earlier infrastructure handoff.

The VPS is managed by **@CelesteRed on Discord**. For changes, DM @CelesteRed, open a GitHub issue, or submit a pull request if you have implemented the change. See the [main README](../README.md) for contact and contribution details.

## Infrastructure setup snapshot

- Sxber public IPv4: 83.147.217.242; SSH remains on TCP 6767.
- Nginx, WireGuard, UFW, Certbot, conntrack and tcpdump installed.
- nginx, ufw and wg-quick@wg-sxber are active and enabled at boot.
- New tunnel: wg-sxber, VPS 10.77.0.1/30, Wings1 10.77.0.2/30.
- VPS listens on UDP 51820; Wings1 listens on UDP 51821.
- The Wings1 tunnel is installed and active, with a recent handshake verified from Sxber.
- End-to-end TCP and UDP tests passed through public 83.147.217.242:25598 to a temporary listener on Wings1 10.77.0.2:25598. Both listeners observed the actual external client IPv4 address, 71.183.247.196. The test listener has exited.
- IPv6 is disabled persistently on both Sxber and the main VPS using /etc/sysctl.d/99-zz-ipv4-only.conf. Both use UFW IPV6=no, have no UFW IPv6 allow entries, and use IPv4-only SSH listeners.
- Wings1's existing wg0 configuration was not changed.
- Reference VPS SSH works through: ssh -J wings1 vps

## Ports

All game ranges below forward TCP and UDP from the Sxber public IP to Wings1's new tunnel address, preserving destination ports:

19132; 20030–20099; 21130–25599; 26630–29969; 40030–40099; 41130–45599; 46630–49969.

25565 is included in 21130–25599.

SFTP TCP 2201–2204 and database TCP 3301–3304 have been removed from Sxber's UFW and DNAT rules. The main VPS retains its existing IPv4 SFTP/database rules. Every Sxber game range forwards to Wings1.

TCP 80 and 443 remain local to Nginx. SSH 6767 and WireGuard UDP 51820 are also excluded from forwarding.

IPv4 forwarding and loose rp_filter=2 match the reference VPS. Inbound traffic receives DNAT only. MASQUERADE applies only to tunnel-source traffic leaving the public interface. Both VPSes have no IPv6 addresses or routes; IPv6 is disabled for current and future interfaces, including loopback.

## Wings1 installer reference

The prepared installer is already on Wings1 at /home/celeste/.sxber-setup/install.sh. A copy is included here as install-wings1.sh.

Installation is already complete; do not rerun the installer on the active tunnel. The original installation command was:

    ssh -t wings1 "sudo bash /home/celeste/.sxber-setup/install.sh"

The password is entered directly in your terminal. The script creates a root-only backup, checks for conflicting addresses/routing IDs, installs a separate WireGuard interface and routing hook, and enables it without restarting wg0 or Docker.

Wings1 uses routing table 51821 and policy priorities 89–91. It marks Sxber connections with masked bit 0x01000000 and restores that bit on replies, including container replies. Outer WireGuard packets use fwmark 51820 to bypass the existing wg0 full tunnel. Ordinary traffic retains its existing route.

The script has passed bash syntax checks. The routing hook's install/remove operations, iptables rule syntax, ordinary routing, marked reply routing, source routing, and Docker-bound inbound routing passed an isolated Linux network-namespace test on Sxber. This does not replace live TCP/UDP and source-IP testing.

Verified after the IPv4-only change: a recent handshake, tunnel pings, real client IP preservation for external TCP and UDP traffic, and forwarding after UFW reload. The main VPS's IPv4 NAT rules are unchanged and its tunnel ping to Wings1 succeeds. Neither server was rebooted.

New Pterodactyl allocations should bind 10.77.0.2 or an appropriate wildcard. Services bound exclusively to 10.0.0.21 need a separate allocation. A future reboot/tunnel restart has not been tested.

## Website setup snapshot

The repository identifies the domain as thesxber.com. Nginx is configured for thesxber.com and www.thesxber.com and proxies to the repository app's port, 127.0.0.1:8787.

Docker and Nginx are prepared for a future site at 127.0.0.1:8787. The v2 app was briefly deployed for testing and then stopped after the user's clarification. HTTPS currently serves a 503 setup page. See WEBSITE.md for the current state and operating commands. The ACME challenge location serves /var/www/letsencrypt.

Nginx now proxies HTTPS on 443 to Docker and redirects HTTP to the same hostname over HTTPS. It uses a temporary self-signed certificate for origin testing; browser-trusted HTTPS remains pending DNS validation and Let's Encrypt issuance.

DNS currently returns Cloudflare proxy addresses; the origin record could not be inspected. Set the website's origin A record to 83.147.217.242 when ready for cutover, then issue/install the domain certificate and configure HTTPS. No DNS records were changed. Use a DNS-only record for ordinary Minecraft TCP/UDP traffic.

Nginx configuration: /etc/nginx/sites-available/thesxber
Firewall DNAT/MSS rules: /etc/ufw/before.rules
UFW after.init invokes /usr/local/sbin/sxber-firewall-dedup to prevent duplicate Sxber NAT/MSS entries when UFW reloads built-in chains. Source: sxber-firewall-dedup.py. Verified 14 game DNAT rules, one outbound MASQUERADE rule and two MSS rules after reload.
Network settings: /etc/sysctl.d/99-sxber-network.conf
VPS WireGuard configuration: /etc/wireguard/wg-sxber.conf

## Backups and rollback

VPS original firewall/sysctl state and post-install default Nginx configuration: /root/sxber-setup-backup.
The VPS installer copy here records what was applied; it intentionally refuses to overwrite an existing tunnel.

Wings1's installer creates /root/sxber-setup-backup-TIMESTAMP. Its routing hook is /usr/local/sbin/sxber-routing and only manages SXBER_* chains and the dedicated policy rules.

To stop the new tunnel on Wings1 without affecting wg0:

    sudo systemctl disable --now wg-quick@wg-sxber

This removes its routing/firewall hooks. Stopping only the VPS tunnel leaves DNAT configured; traffic to game ranges will fail until it is restored.

Private keys are stored with restrictive permissions on their respective hosts, not in this repository.

IPv4-only change backups: /root/ipv4-only-backup-20260911-182308 on Sxber and /root/ipv4-only-backup-20260911-182320 on the main VPS.
