#!/usr/bin/env bash
# Yerel dev Redis'e (dev-redis.sh) örnek veri yükler: her tür, Türkçe ve büyük/küçük harfli adlar, ikili anahtar,
# TTL'li anahtarlar ve hız denemesi için çok sayıda anahtar. Yalnızca 127.0.0.1'deki geçici örneklere yazar.
#   wsl -d aWork-build -u root -- bash /mnt/e/Github/AtakRedisDesktopManager/scripts/dev-redis-seed.sh [port] [db] [adet]
set -euo pipefail
PORT="${1:-6390}"
DB="${2:-0}"
COUNT="${3:-20000}"
cli() { redis-cli -h 127.0.0.1 -p "$PORT" -n "$DB" "$@"; }

cli FLUSHDB >/dev/null
{
  for ((i = 1; i <= COUNT; i++)); do
    case $((i % 6)) in
      0) printf 'HSET user:%d name "Kullanıcı %d" email user%d@example.com city İstanbul\n' "$i" "$i" "$i" ;;
      1) printf 'SET session:%d "{\\"userId\\":%d}" EX %d\n' "$i" "$i" $((600 + i)) ;;
      2) printf 'SET cache:product:%d "{\\"id\\":%d,\\"title\\":\\"Ürün %d\\",\\"price\\":%d.90}"\n' "$i" "$i" "$i" "$i" ;;
      3) printf 'SET Cache:Product:%d:Meta meta-%d\n' "$i" "$i" ;;
      4) printf 'SADD tags:post:%d redis tauri svelte t%d\n' "$i" $((i % 13)) ;;
      5) printf 'ZADD leaderboard:season:%d %d player:%d\n' $((i % 7)) "$i" "$i" ;;
    esac
  done
  for city in İstanbul Ankara İzmir Iğdır ISTANBUL istanbul; do
    printf 'SET "kullanıcı:%s:1" "%s sakini"\n' "$city" "$city"
  done
  printf 'RPUSH queue:emails a@example.com b@example.com c@example.com\n'
  printf 'XADD events:clicks * type click page /home\n'
  printf 'XADD events:clicks * type click page /pricing\n'
  printf 'SET "KULLANICI:İSTANBUL:özel" "büyük harfli Türkçe"\n'
} | cli --pipe >/dev/null

# İkili anahtar ve gzip'li değer
printf '\xff\x00AB' | cli -x SET >/dev/null 2>&1 || true
printf 'merhaba dünya merhaba dünya' | gzip | cli -x SET blob:gzip >/dev/null
cli DBSIZE
