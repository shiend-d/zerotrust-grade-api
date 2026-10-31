#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:${GATEWAY_PORT:-3000}}"
NILAI_URL="${NILAI_URL:-http://127.0.0.1:${NILAI_PORT:-3001}}"
GATEWAY_SECRET_VALUE="${GATEWAY_SECRET:-pep-gateway-internal-secret-2026}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INTERACTIVE=0
if [[ -t 0 && -t 1 ]]; then INTERACTIVE=1; fi
case "${1:-}" in
  --interactive) INTERACTIVE=1 ;;
  --auto) INTERACTIVE=0 ;;
  "") ;;
  *) echo "Usage: bash demo.sh [--interactive|--auto]" >&2; exit 2 ;;
esac
LOG_FILE="$(mktemp)"
SERVER_PID=""
RESPONSE_FILE="$(mktemp)"
DEMO_DB_FILE=""
STEP=0
DEMO_LOG="${DEMO_LOG:-$SCRIPT_DIR/demo-run.md}"
: > "$DEMO_LOG"
chmod 600 "$DEMO_LOG"
exec 2> >(tee -a "$DEMO_LOG")

say() {
  printf '%s\n' "$*" | tee -a "$DEMO_LOG"
}

curl_command() {
  local arg escaped
  printf 'curl -sS'
  for arg in "$@"; do
    escaped=${arg//\'/\'\\\'\'}
    printf " '%s'" "$escaped"
  done
}

say '# Demo Zero Trust Sistem Nilai'
say "Waktu: $(date --iso-8601=seconds)"
say 'Token dipotong di tampilan; request tetap memakai token lengkap.'

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$LOG_FILE" "$RESPONSE_FILE"
  if [[ -n "$DEMO_DB_FILE" ]]; then rm -f "$DEMO_DB_FILE" "$DEMO_DB_FILE-wal" "$DEMO_DB_FILE-shm"; fi
}
trap cleanup EXIT INT TERM

if curl -fsS "$BASE_URL/health" >/dev/null 2>&1; then
  say "Gateway sudah berjalan di $BASE_URL. Hentikan server lama lalu jalankan demo kembali."
  exit 1
fi

say 'Memulai tiga service dengan database sementara...'
DEMO_DB_FILE="$(mktemp)"
DEMO_MODE=1 DATABASE_PATH="$DEMO_DB_FILE" node start-all.js >"$LOG_FILE" 2>&1 &
SERVER_PID=$!
ready=0
for _ in $(seq 1 50); do
  if curl -fsS "$BASE_URL/health" >/dev/null 2>&1; then ready=1; break; fi
  sleep 0.2
done
if [[ "$ready" != 1 ]]; then
  cat "$LOG_FILE"
  echo "Gateway did not become ready" >&2
  exit 1
fi

request() {
  shift
  local method=GET url endpoint url_parts index status
  local -a curl_args=("$@")
  STEP=$((STEP + 1))
  say ''
  index=0
  while ((index < ${#curl_args[@]})); do
    case "${curl_args[index]}" in
      -X) method="${curl_args[index + 1]}"; index=$((index + 2)) ;;
      -H|-d) index=$((index + 2)) ;;
      http://*|https://*) url="${curl_args[index]}"; index=$((index + 1)) ;;
      *) index=$((index + 1)) ;;
    esac
  done
  url_parts="${url#*://}"
  endpoint="/${url_parts#*/}"
  say "Langkah $STEP: $method $endpoint"
  say "Command: $(curl_command "$@")"
  if [[ "$INTERACTIVE" == 1 ]]; then
    read -r _ </dev/tty
  fi
  status=$(curl -sS -o "$RESPONSE_FILE" -w '%{http_code}' "$@")
  say "[$status] $method $endpoint"
  if [[ "$endpoint" == "/audit-logs" ]]; then
    printf '%s\n' '```text' >> "$DEMO_LOG"
    printf 'id\tsubjek\tendpoint\thasil\talasan\n' | tee -a "$DEMO_LOG"
    jq -r '.logs[-28:][] | [.id, .subjek, .endpoint, .hasil, .alasan] | @tsv' "$RESPONSE_FILE" | tee -a "$DEMO_LOG"
  else
    printf '%s\n' '```json' >> "$DEMO_LOG"
    jq 'if .access_token then .access_token = (.access_token[0:25] + "...") else . end
      | if .refresh_token then .refresh_token = (.refresh_token[0:25] + "...") else . end
      | if .service_token then .service_token = (.service_token[0:25] + "...") else . end' "$RESPONSE_FILE" | tee -a "$DEMO_LOG"
  fi
  printf '%s\n' '```' >> "$DEMO_LOG"
}

login() {
  local username="$1" password="$2" device="$3" name="$4"
  request "Login $username menggunakan device terdaftar untuk skenario demo berikutnya." -X POST "$BASE_URL/auth/login" \
    -H "X-Device-ID: $device" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$username\",\"password\":\"$password\"}"
  printf -v "$name" '%s' "$(sed -n '/^{/,$p' "$RESPONSE_FILE" | jq -r '.access_token')"
}

say '## Skenario 1: autentikasi, verifikasi device, refresh, dan logout'
request 'Login device tidak terdaftar.' -X POST "$BASE_URL/auth/login" \
  -H 'X-Device-ID: dev-wrong' -H 'Content-Type: application/json' \
  -d '{"username":"dosen1","password":"dosen123"}'
request 'Login dosen1 dengan device terdaftar untuk memperoleh access dan refresh token.' -X POST "$BASE_URL/auth/login" \
  -H 'X-Device-ID: dev-dosen-01' -H 'Content-Type: application/json' \
  -d '{"username":"dosen1","password":"dosen123"}'
refresh_token=$(sed -n '/^{/,$p' "$RESPONSE_FILE" | jq -r '.refresh_token')
request 'Kirim refresh token untuk meminta access token baru.' -X POST "$BASE_URL/auth/refresh" -H 'X-Device-ID: dev-dosen-01' \
  -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$refresh_token\"}"
request 'Logout dengan refresh token untuk mencabutnya.' -X POST "$BASE_URL/auth/logout" -H 'X-Device-ID: dev-dosen-01' \
  -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$refresh_token\"}"
request 'Coba gunakan kembali refresh token yang sudah dicabut.' -X POST "$BASE_URL/auth/refresh" -H 'X-Device-ID: dev-dosen-01' \
  -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$refresh_token\"}"

login dosen1 dosen123 dev-dosen-01 dosen1_token
login dosen2 dosen123 dev-dosen-02 dosen2_token
login mhs1 mhs123 dev-mhs-01 mhs1_token
login mhs2 mhs123 dev-mhs-02 mhs2_token
login admin admin123 dev-admin-01 admin_token

say '## Skenario 2: gateway secret dan verifikasi JWT ulang di service'
request 'Request ke Gateway tanpa token.' "$BASE_URL/nilai"
request 'Token valid dengan device yang salah.' "$BASE_URL/nilai" \
  -H "Authorization: Bearer $mhs1_token" -H 'X-Device-ID: dev-wrong'
request 'Meminta token service dengan secret yang salah.' -X POST "$BASE_URL/auth/service" \
  -H 'Content-Type: application/json' -d '{"client_id":"service-nilai","client_secret":"secret-salah"}'
request 'Akses langsung ke service tanpa gateway secret.' "$NILAI_URL/nilai"
request 'Akses service dengan gateway secret tetapi tanpa JWT.' "$NILAI_URL/nilai" \
  -H "X-Gateway-Secret: $GATEWAY_SECRET_VALUE"

say '## Skenario 3: kebijakan nilai, kepemilikan kelas, dan jam akses'
request 'Mahasiswa meminta daftar nilai.' "$BASE_URL/nilai" -H "Authorization: Bearer $mhs1_token" -H 'X-Device-ID: dev-mhs-01'
request 'Dosen meminta daftar nilai kelas.' "$BASE_URL/nilai" -H "Authorization: Bearer $dosen1_token" -H 'X-Device-ID: dev-dosen-01'
request 'Dosen1 mencoba mengubah nilai kelas dosen2.' -X PUT "$BASE_URL/nilai/3" \
  -H "Authorization: Bearer $dosen1_token" -H 'X-Device-ID: dev-dosen-01' -H 'X-Simulated-Hour: 10' \
  -H 'Content-Type: application/json' -d '{"nilai_angka":90,"nilai_huruf":"A"}'
request 'Dosen1 mencoba mengubah nilai pada jam simulasi 23.' -X PUT "$BASE_URL/nilai/1" \
  -H "Authorization: Bearer $dosen1_token" -H 'X-Device-ID: dev-dosen-01' -H 'X-Simulated-Hour: 23' \
  -H 'Content-Type: application/json' -d '{"nilai_angka":90,"nilai_huruf":"A"}'
request 'Dosen1 mengubah nilai kelasnya pada jam simulasi 10.' -X PUT "$BASE_URL/nilai/1" \
  -H "Authorization: Bearer $dosen1_token" -H 'X-Device-ID: dev-dosen-01' -H 'X-Simulated-Hour: 10' \
  -H 'Content-Type: application/json' -d '{"nilai_angka":90,"nilai_huruf":"A"}'

say '## Skenario 4: finalisasi dan sinkronisasi dengan token service'
request 'Dosen1 mencoba memanggil endpoint sinkronisasi transkrip.' -X POST "$BASE_URL/transkrip/sinkron" \
  -H "Authorization: Bearer $dosen1_token" -H 'X-Device-ID: dev-dosen-01' \
  -H 'Content-Type: application/json' -d '{"kelas_id":1,"records":[]}'
request 'Dosen1 memfinalisasi kelas; service akan meminta token dan menyinkronkan transkrip melalui gateway.' -X POST "$BASE_URL/kelas/1/finalisasi" \
  -H "Authorization: Bearer $dosen1_token" -H 'X-Device-ID: dev-dosen-01' -H 'X-Simulated-Hour: 10'
request 'Dosen1 mencoba mengubah nilai setelah finalisasi.' -X PUT "$BASE_URL/nilai/1" \
  -H "Authorization: Bearer $dosen1_token" -H 'X-Device-ID: dev-dosen-01' -H 'X-Simulated-Hour: 10' \
  -H 'Content-Type: application/json' -d '{"nilai_angka":91,"nilai_huruf":"A"}'

say '## Skenario 5: kepemilikan transkrip dan akses admin'
request 'Mahasiswa1 meminta transkrip dengan NIM miliknya.' "$BASE_URL/transkrip/237006001" \
  -H "Authorization: Bearer $mhs1_token" -H 'X-Device-ID: dev-mhs-01'
request 'Mahasiswa1 meminta transkrip mahasiswa2.' "$BASE_URL/transkrip/237006002" \
  -H "Authorization: Bearer $mhs1_token" -H 'X-Device-ID: dev-mhs-01'
request 'Dosen1 meminta transkrip mahasiswa.' "$BASE_URL/transkrip/237006001" \
  -H "Authorization: Bearer $dosen1_token" -H 'X-Device-ID: dev-dosen-01'
request 'Admin meminta transkrip mahasiswa2.' "$BASE_URL/transkrip/237006002" \
  -H "Authorization: Bearer $admin_token" -H 'X-Device-ID: dev-admin-01'

say '## Skenario 6: audit log'
request 'Admin meminta audit log gateway.' "$BASE_URL/audit-logs" \
  -H "Authorization: Bearer $admin_token" -H 'X-Device-ID: dev-admin-01'
say 'Demo selesai.'
say "Laporan tersimpan di: $DEMO_LOG"
