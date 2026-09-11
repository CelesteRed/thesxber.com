#!/usr/bin/python3
"""Keep only one copy of Sxber's rules after UFW reloads built-in chains."""
import shlex
import subprocess
for table in ("nat", "mangle"):
    rules = subprocess.check_output(["iptables", "-w", "-t", table, "-S"], text=True)
    seen = set()
    for line in rules.splitlines():
        parts = shlex.split(line)
        if not parts or parts[0] != "-A":
            continue
        managed = (
            table == "nat" and (
                "--to-destination 10.77.0.2" in line and "-d 83.147.217.242/32" in line
                or "-s 10.77.0.0/30 -o ens3 -j MASQUERADE" in line
            )
            or table == "mangle" and "wg-sxber" in parts and "TCPMSS" in parts
        )
        if not managed:
            continue
        if line in seen:
            subprocess.run(["iptables", "-w", "-t", table, "-D", *parts[1:]], check=True)
        seen.add(line)

