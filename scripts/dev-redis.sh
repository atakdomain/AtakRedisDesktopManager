#!/usr/bin/env bash
# Throwaway local Redis instances for development and the ignored integration tests.
# Runs as root inside WSL (Ubuntu 22.04):
#   wsl.exe -d aWork-build -u root -- bash /mnt/e/Github/AtakRedisDesktopManager/scripts/dev-redis.sh start|stop|status
# Everything binds to 127.0.0.1 (WSL2 forwards localhost to Windows) and nothing is persisted.
#
#   6390        standalone, no auth
#   6391        requirepass testpass + ACL user tester/testpass2
#   6392        TLS (self-signed CA, client certs optional)
#   7101-7103   3-master cluster
#   6393/26390  master + sentinel "mymaster"
#   2222        sshd, user ardmtest/ardmtest + ed25519 key (plain and passphrase "keypass")
set -euo pipefail

BASE=/root/ardm-dev
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
OUT="$REPO/src-tauri/target/dev-redis"
REDIS_PORTS=(6390 6391 6392 6393 7101 7102 7103)
SENTINEL_PORT=26390
SSH_PORT=2222

log() { echo "[dev-redis] $*"; }

ensure_packages() {
  local missing=()
  command -v redis-server >/dev/null || missing+=(redis-server)
  [ -x /usr/sbin/sshd ] || missing+=(openssh-server)
  command -v openssl >/dev/null || missing+=(openssl)
  if [ ${#missing[@]} -gt 0 ]; then
    log "installing ${missing[*]}"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq "${missing[@]}" >/dev/null
  fi
  # the distro-wide services would occupy 6379/22; only our own instances should run
  if command -v systemctl >/dev/null && [ -d /run/systemd/system ]; then
    systemctl disable --now redis-server >/dev/null 2>&1 || true
    systemctl disable --now ssh >/dev/null 2>&1 || true
  fi
}

port_up() { redis-cli -p "$1" PING >/dev/null 2>&1; }

write_redis_conf() { # port extra-lines...
  local port=$1; shift
  local dir="$BASE/$port"
  mkdir -p "$dir"
  {
    echo "bind 127.0.0.1"
    echo "port $port"
    echo "daemonize yes"
    echo "dir $dir"
    echo "pidfile $dir/redis.pid"
    echo "logfile $dir/redis.log"
    echo 'save ""'
    echo "appendonly no"
    echo "protected-mode no"
    for line in "$@"; do echo "$line"; done
  } > "$dir/redis.conf"
}

gen_tls() {
  local d="$BASE/tls"
  if [ ! -f "$d/server.crt" ]; then
    log "generating TLS certificates"
    mkdir -p "$d"
    openssl genrsa -out "$d/ca.key" 2048 2>/dev/null
    openssl req -x509 -new -nodes -key "$d/ca.key" -sha256 -days 3650 -subj "/CN=ARDM Dev CA" -out "$d/ca.crt"
    openssl genrsa -out "$d/server.key" 2048 2>/dev/null
    openssl req -new -key "$d/server.key" -subj "/CN=localhost" -out "$d/server.csr"
    printf "subjectAltName=DNS:localhost,IP:127.0.0.1\n" > "$d/server.ext"
    openssl x509 -req -in "$d/server.csr" -CA "$d/ca.crt" -CAkey "$d/ca.key" -CAcreateserial \
      -days 3650 -sha256 -extfile "$d/server.ext" -out "$d/server.crt" 2>/dev/null
  fi
  # client.ext: X.509 v3 is required by rustls/webpki for client certificates
  if [ ! -f "$d/client.ext" ]; then
    printf "basicConstraints=CA:FALSE\nextendedKeyUsage=clientAuth\n" > "$d/client.ext"
    openssl genrsa -out "$d/client.key" 2048 2>/dev/null
    openssl req -new -key "$d/client.key" -subj "/CN=ardm-client" -out "$d/client.csr"
    openssl x509 -req -in "$d/client.csr" -CA "$d/ca.crt" -CAkey "$d/ca.key" -CAcreateserial \
      -days 3650 -sha256 -extfile "$d/client.ext" -out "$d/client.crt" 2>/dev/null
  fi
  mkdir -p "$OUT"
  cp "$d/ca.crt" "$d/client.crt" "$d/client.key" "$OUT/"
}

start_redis() {
  local port=$1
  if port_up "$port" || redis-cli --tls --cacert "$BASE/tls/ca.crt" -p "$port" PING >/dev/null 2>&1; then
    return
  fi
  redis-server "$BASE/$port/redis.conf"
}

start_cluster() {
  for p in 7101 7102 7103; do
    write_redis_conf "$p" "cluster-enabled yes" "cluster-config-file nodes-$p.conf" \
      "cluster-node-timeout 5000" "cluster-announce-ip 127.0.0.1"
    start_redis "$p"
  done
  for p in 7101 7102 7103; do
    for _ in $(seq 50); do port_up "$p" && break; sleep 0.1; done
  done
  if ! redis-cli -p 7101 CLUSTER INFO | grep -q "cluster_state:ok"; then
    if [ "$(redis-cli -p 7101 CLUSTER INFO | grep cluster_slots_assigned | tr -dc 0-9)" = "0" ]; then
      log "creating cluster"
      redis-cli --cluster create 127.0.0.1:7101 127.0.0.1:7102 127.0.0.1:7103 \
        --cluster-replicas 0 --cluster-yes >/dev/null
    fi
    for _ in $(seq 100); do
      redis-cli -p 7101 CLUSTER INFO | grep -q "cluster_state:ok" && break
      sleep 0.1
    done
  fi
}

start_sentinel() {
  local dir="$BASE/$SENTINEL_PORT"
  if port_up "$SENTINEL_PORT"; then return; fi
  mkdir -p "$dir"
  cat > "$dir/sentinel.conf" <<EOF
bind 127.0.0.1
port $SENTINEL_PORT
daemonize yes
dir $dir
pidfile $dir/sentinel.pid
logfile $dir/sentinel.log
protected-mode no
sentinel monitor mymaster 127.0.0.1 6393 1
sentinel down-after-milliseconds mymaster 5000
EOF
  redis-server "$dir/sentinel.conf" --sentinel
}

start_sshd() {
  local d="$BASE/ssh"
  mkdir -p "$d" /run/sshd
  id ardmtest >/dev/null 2>&1 || useradd -m -s /bin/bash ardmtest
  echo "ardmtest:ardmtest" | chpasswd
  [ -f "$d/host_ed25519" ] || ssh-keygen -q -t ed25519 -N "" -f "$d/host_ed25519"
  [ -f "$d/id_ed25519" ] || ssh-keygen -q -t ed25519 -N "" -C ardmtest -f "$d/id_ed25519"
  [ -f "$d/id_ed25519_pass" ] || ssh-keygen -q -t ed25519 -N "keypass" -C ardmtest-pass -f "$d/id_ed25519_pass"
  install -d -m 700 -o ardmtest -g ardmtest /home/ardmtest/.ssh
  cat "$d/id_ed25519.pub" "$d/id_ed25519_pass.pub" > /home/ardmtest/.ssh/authorized_keys
  chown ardmtest:ardmtest /home/ardmtest/.ssh/authorized_keys
  chmod 600 /home/ardmtest/.ssh/authorized_keys
  mkdir -p "$OUT"
  cp "$d/id_ed25519" "$d/id_ed25519_pass" "$OUT/"
  cat > "$d/sshd_config" <<EOF
Port $SSH_PORT
ListenAddress 127.0.0.1
HostKey $d/host_ed25519
PidFile $d/sshd.pid
PasswordAuthentication yes
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
UsePAM no
AllowTcpForwarding yes
PermitRootLogin no
EOF
  if [ -f "$d/sshd.pid" ] && kill -0 "$(cat "$d/sshd.pid")" 2>/dev/null; then return; fi
  /usr/sbin/sshd -f "$d/sshd_config"
}

start() {
  ensure_packages
  mkdir -p "$BASE"
  gen_tls
  local t="$BASE/tls"
  write_redis_conf 6390
  write_redis_conf 6391 "requirepass testpass" "user tester on >testpass2 ~* +@all"
  write_redis_conf 6392 "port 0" "tls-port 6392" "tls-cert-file $t/server.crt" "tls-key-file $t/server.key" \
    "tls-ca-cert-file $t/ca.crt" "tls-auth-clients optional"
  write_redis_conf 6393
  for p in 6390 6391 6392 6393; do start_redis "$p"; done
  start_cluster
  start_sentinel
  start_sshd
  status
}

stop() {
  for p in "${REDIS_PORTS[@]}" "$SENTINEL_PORT"; do
    for pidfile in "$BASE/$p/redis.pid" "$BASE/$p/sentinel.pid"; do
      [ -f "$pidfile" ] && kill "$(cat "$pidfile")" 2>/dev/null || true
    done
  done
  [ -f "$BASE/ssh/sshd.pid" ] && kill "$(cat "$BASE/ssh/sshd.pid")" 2>/dev/null || true
  sleep 0.5
  # throwaway: cluster/sentinel state goes too; certificates and keys stay
  for p in "${REDIS_PORTS[@]}" "$SENTINEL_PORT"; do rm -rf "${BASE:?}/$p"; done
  log "stopped"
}

status() {
  local p
  for p in 6390 6393 7101 7102 7103 "$SENTINEL_PORT"; do
    printf "%-6s %s\n" "$p" "$(redis-cli -p "$p" PING 2>/dev/null || echo down)"
  done
  printf "%-6s %s\n" 6391 "$(redis-cli -p 6391 -a testpass --no-auth-warning PING 2>/dev/null || echo down)"
  printf "%-6s %s\n" 6392 "$(redis-cli --tls --cacert "$BASE/tls/ca.crt" -p 6392 PING 2>/dev/null || echo down)"
  printf "%-6s %s\n" cluster "$(redis-cli -p 7101 CLUSTER INFO 2>/dev/null | grep cluster_state | tr -d '\r' || echo down)"
  if [ -f "$BASE/ssh/sshd.pid" ] && kill -0 "$(cat "$BASE/ssh/sshd.pid")" 2>/dev/null; then
    printf "%-6s %s\n" "$SSH_PORT" "sshd up"
  else
    printf "%-6s %s\n" "$SSH_PORT" "sshd down"
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
