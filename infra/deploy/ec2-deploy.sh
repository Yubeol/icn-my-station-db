#!/usr/bin/env bash
set -Eeuo pipefail

# Installed as /usr/local/sbin/icn-deploy on the application EC2 instance.
# This script never modifies /etc/icn/backend.env; Docker only reads it.

readonly NGINX_SITE="/etc/nginx/sites-available/icn-dashboard"
readonly FRONTEND_LINK="/var/www/icn-dashboard"
readonly RELEASE_ROOT="/var/www/icn-dashboard-releases"
readonly STATE_DIR="/var/lib/icn-dashboard-deploy"
readonly STATE_FILE="${STATE_DIR}/current.env"
readonly LOCK_FILE="/var/lock/icn-dashboard-deploy.lock"
readonly BACKEND_ENV="/etc/icn/backend.env"
readonly PORT_BLUE="8002"
readonly PORT_GREEN="8003"
readonly HEALTH_ATTEMPTS="30"
readonly HEALTH_DELAY_SECONDS="2"

log() {
  printf '[icn-deploy] %s\n' "$*"
}

fail() {
  printf '[icn-deploy] ERROR: %s\n' "$*" >&2
  return 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command is unavailable: $1"
}

if [ "${EUID}" -ne 0 ]; then
  fail "Run this script as root."
fi

if [ "$#" -ne 3 ]; then
  fail "Usage: icn-deploy <40-char-sha> <ecr-image-uri> <frontend-s3-uri>"
fi

readonly DEPLOY_SHA="$1"
readonly IMAGE_URI="$2"
readonly FRONTEND_URI="$3"

[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "Invalid Git commit SHA."
[[ "$IMAGE_URI" == *":${DEPLOY_SHA}" ]] || fail "Image tag must exactly match the Git commit SHA."
[[ "$FRONTEND_URI" == s3://*"/${DEPLOY_SHA}/frontend.tar.gz" ]] || fail "Frontend URI must contain the Git commit SHA."

for command in aws chmod cmp cp curl docker flock grep ln mktemp mv nginx readlink rm sed seq systemctl tar; do
  require_command "$command"
done

[ -r "$BACKEND_ENV" ] || fail "Backend environment file is not readable: ${BACKEND_ENV}"
[ -f "$NGINX_SITE" ] || fail "Nginx site file is missing: ${NGINX_SITE}"
[ -L "$FRONTEND_LINK" ] || fail "Frontend path must be a symlink before automated deployment: ${FRONTEND_LINK}"
[ -f "$STATE_FILE" ] || fail "Deployment state is missing. Complete the one-time bootstrap first: ${STATE_FILE}"

if [ -f /etc/icn/deploy.conf ]; then
  # shellcheck disable=SC1091
  source /etc/icn/deploy.conf
fi
: "${AWS_REGION:?AWS_REGION must be set in /etc/icn/deploy.conf}"

mkdir -p "$RELEASE_ROOT" "$STATE_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || fail "Another dashboard deployment is already running."

# shellcheck disable=SC1090
source "$STATE_FILE"
: "${ACTIVE_PORT:?ACTIVE_PORT is missing from the deployment state}"
: "${ACTIVE_CONTAINER:?ACTIVE_CONTAINER is missing from the deployment state}"
: "${ACTIVE_SHA:?ACTIVE_SHA is missing from the deployment state}"
: "${FRONTEND_RELEASE:?FRONTEND_RELEASE is missing from the deployment state}"

case "$ACTIVE_PORT" in
  "$PORT_BLUE") NEXT_PORT="$PORT_GREEN" ;;
  "$PORT_GREEN") NEXT_PORT="$PORT_BLUE" ;;
  *) fail "ACTIVE_PORT must be ${PORT_BLUE} or ${PORT_GREEN}." ;;
esac
readonly NEXT_PORT

if [ "$ACTIVE_SHA" = "$DEPLOY_SHA" ]; then
  log "Commit ${DEPLOY_SHA} is already active; nothing to do."
  exit 0
fi

docker inspect "$ACTIVE_CONTAINER" >/dev/null 2>&1 || fail "Active container does not exist: ${ACTIVE_CONTAINER}"
docker ps --format '{{.Names}}' | grep -Fxq "$ACTIVE_CONTAINER" || fail "Active container is not running: ${ACTIVE_CONTAINER}"

readonly NEW_CONTAINER="icn-backend-${DEPLOY_SHA}"
readonly RELEASE_DIR="${RELEASE_ROOT}/${DEPLOY_SHA}"
readonly WORK_DIR="$(mktemp -d "${STATE_DIR}/deploy-${DEPLOY_SHA}.XXXXXX")"
readonly NGINX_BACKUP="${WORK_DIR}/icn-dashboard.nginx.previous"
readonly NGINX_CANDIDATE="${WORK_DIR}/icn-dashboard.nginx.next"
readonly PREVIOUS_FRONTEND_TARGET="$(readlink -f "$FRONTEND_LINK")"

frontend_switched=0
nginx_touched=0
deployment_committed=0

rollback() {
  local exit_code=$?
  trap - ERR INT TERM

  if [ "$deployment_committed" -eq 0 ]; then
    log "Deployment failed; restoring the previous release."

    if [ "$nginx_touched" -eq 1 ] && [ -f "$NGINX_BACKUP" ]; then
      cp -a "$NGINX_BACKUP" "$NGINX_SITE"
      if nginx -t; then
        systemctl reload nginx || true
      fi
    fi

    if [ "$frontend_switched" -eq 1 ] && [ -d "$PREVIOUS_FRONTEND_TARGET" ]; then
      ln -s "$PREVIOUS_FRONTEND_TARGET" "${FRONTEND_LINK}.rollback"
      mv -Tf "${FRONTEND_LINK}.rollback" "$FRONTEND_LINK"
    fi

    docker rm -f "$NEW_CONTAINER" >/dev/null 2>&1 || true
  fi

  rm -rf "$WORK_DIR"
  exit "$exit_code"
}
trap rollback ERR INT TERM
rm -f "${FRONTEND_LINK}.next" "${FRONTEND_LINK}.rollback"

log "Downloading the verified frontend artifact."
aws s3 cp "$FRONTEND_URI" "${WORK_DIR}/frontend.tar.gz" \
  --region "$AWS_REGION" \
  --only-show-errors

if tar -tzf "${WORK_DIR}/frontend.tar.gz" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  fail "Frontend archive contains an unsafe path."
fi

mkdir "${WORK_DIR}/frontend"
tar -xzf "${WORK_DIR}/frontend.tar.gz" -C "${WORK_DIR}/frontend"
[ -s "${WORK_DIR}/frontend/index.html" ] || fail "Frontend artifact does not contain index.html."

if [ ! -d "$RELEASE_DIR" ]; then
  mv "${WORK_DIR}/frontend" "$RELEASE_DIR"
fi

log "Pulling backend image ${IMAGE_URI}."
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${IMAGE_URI%%/*}" >/dev/null
docker pull "$IMAGE_URI"

image_revision="$(docker image inspect "$IMAGE_URI" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
[ "$image_revision" = "$DEPLOY_SHA" ] || fail "Backend image revision label does not match the deployment SHA."

docker rm -f "$NEW_CONTAINER" >/dev/null 2>&1 || true
docker run -d \
  --name "$NEW_CONTAINER" \
  --restart unless-stopped \
  --env-file "$BACKEND_ENV" \
  --label "icn.dashboard.sha=${DEPLOY_SHA}" \
  -p "127.0.0.1:${NEXT_PORT}:8000" \
  "$IMAGE_URI" >/dev/null

log "Waiting for the new backend on port ${NEXT_PORT}."
backend_healthy=0
for _ in $(seq 1 "$HEALTH_ATTEMPTS"); do
  if curl --fail --silent --show-error --max-time 5 \
      "http://127.0.0.1:${NEXT_PORT}/openapi.json" >/dev/null \
    && curl --fail --silent --show-error --max-time 10 \
      "http://127.0.0.1:${NEXT_PORT}/api/v1/dashboard/summary" >/dev/null; then
    backend_healthy=1
    break
  fi
  sleep "$HEALTH_DELAY_SECONDS"
done
[ "$backend_healthy" -eq 1 ] || fail "New backend failed its API health checks."

cp -a "$NGINX_SITE" "$NGINX_BACKUP"
sed "s/127\.0\.0\.1:${ACTIVE_PORT}/127.0.0.1:${NEXT_PORT}/g" \
  "$NGINX_SITE" > "$NGINX_CANDIDATE"
cmp -s "$NGINX_SITE" "$NGINX_CANDIDATE" && fail "Nginx configuration does not reference active port ${ACTIVE_PORT}."

ln -s "$RELEASE_DIR" "${FRONTEND_LINK}.next"
mv -Tf "${FRONTEND_LINK}.next" "$FRONTEND_LINK"
frontend_switched=1

nginx_touched=1
cp -a "$NGINX_CANDIDATE" "$NGINX_SITE"
nginx -t
systemctl reload nginx

# The backend is checked again after Nginx has switched. If a public HTTPS URL is
# configured in /etc/icn/deploy.conf, that endpoint is checked as well.
curl --fail --silent --show-error --max-time 10 \
  "http://127.0.0.1:${NEXT_PORT}/api/v1/dashboard/summary" >/dev/null

if [ -n "${PUBLIC_API_HEALTH_URL:-}" ]; then
  curl --fail --silent --show-error --max-time 15 "$PUBLIC_API_HEALTH_URL" >/dev/null
fi

state_next="${WORK_DIR}/current.env"
cat > "$state_next" <<EOF
ACTIVE_PORT=${NEXT_PORT}
ACTIVE_CONTAINER=${NEW_CONTAINER}
ACTIVE_SHA=${DEPLOY_SHA}
FRONTEND_RELEASE=${RELEASE_DIR}
EOF
chmod 600 "$state_next"
mv -f "$state_next" "$STATE_FILE"

deployment_committed=1
trap - ERR INT TERM

if [ "$ACTIVE_CONTAINER" != "$NEW_CONTAINER" ]; then
  docker stop "$ACTIVE_CONTAINER" >/dev/null || true
fi

rm -rf "$WORK_DIR"
log "Deployment succeeded: ${DEPLOY_SHA} is active on port ${NEXT_PORT}."
