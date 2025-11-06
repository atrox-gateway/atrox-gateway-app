#!/usr/bin/env bash
# /opt/atrox-gateway/scripts/update_nginx_config.sh


#!/usr/bin/env bash
# update_nginx_config.sh - improved

set -euo pipefail

REMOVE=0
DRYRUN=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --remove)
            REMOVE=1; shift;;
        --dry-run)
            DRYRUN=1; shift;;
        --help)
            echo "Usage: $0 [--dry-run] [--remove] USERNAME [SOCKET_PATH]"; exit 0;;
        --*)
            echo "Unknown option: $1" >&2; exit 2;;
        *)
            break;;
    esac
done

USERNAME=${1:-}
SOCKET_PATH=${2:-}

NGINX_DIR="/etc/nginx"
PUN_CONF_DIR="$NGINX_DIR/puns-enabled"
MAP_FILE="$NGINX_DIR/user_map.conf"

if [ -z "$USERNAME" ]; then
    echo "ERROR: Missing username." >&2
    exit 1
fi

# Determine whether to prefix privileged commands with sudo
SUDO_CMD=""
if [ "$(id -u)" -ne 0 ]; then
    SUDO_CMD="sudo"
fi

echo "update_nginx_config.sh: user='$USERNAME' remove=$REMOVE dry-run=$DRYRUN"

# Create puns-enabled dir if missing
if [ $DRYRUN -eq 0 ]; then
    if ! $SUDO_CMD test -d "$PUN_CONF_DIR"; then
        echo "Creating $PUN_CONF_DIR..."
        $SUDO_CMD mkdir -p "$PUN_CONF_DIR"
        $SUDO_CMD chown root:root "$PUN_CONF_DIR" || true
        $SUDO_CMD chmod 755 "$PUN_CONF_DIR" || true
    fi
else
    echo "(dry-run) would ensure directory $PUN_CONF_DIR exists"
fi

TMP_UPSTREAM=$(mktemp)
TMP_MAP=$(mktemp)

cleanup() {
    rm -f "$TMP_UPSTREAM" "$TMP_MAP" || true
}
trap cleanup EXIT

if [ $REMOVE -eq 0 ]; then
    if [ -z "$SOCKET_PATH" ]; then
        echo "ERROR: Missing socket path for add operation." >&2
        exit 1
    fi
    echo "Building upstream for $USERNAME (socket=$SOCKET_PATH)"
    cat > "$TMP_UPSTREAM" <<EOF
upstream ${USERNAME}_pun_backend {
    server unix:${SOCKET_PATH};
}
EOF
else
    echo "Preparing to remove upstream for $USERNAME"
fi

echo "Building new user_map content (mapping lines only)..."
# Start with an empty tmp map file
: > "$TMP_MAP"

if [ -f "$MAP_FILE" ]; then
    # Copy existing mapping lines but exclude any line that references the current username
    # Accept lines like: username "username_pun_backend";  (username may be unquoted)
    $SUDO_CMD grep -v "\"$USERNAME\"" "$MAP_FILE" | grep -v "^$USERNAME[[:space:]]" > "$TMP_MAP" || true
fi

if [ $REMOVE -eq 0 ]; then
    # Append new mapping for this user in the same style as existing file
    echo "$USERNAME \"${USERNAME}_pun_backend\";" >> "$TMP_MAP"
else
    echo "(remove mode) will not add mapping for $USERNAME"
fi

# Back up existing files so we can rollback if nginx -t fails
UPSTREAM_TARGET="$PUN_CONF_DIR/$USERNAME.conf"
MAP_TARGET="$MAP_FILE"
UPSTREAM_BAK="${UPSTREAM_TARGET}.bak"
MAP_BAK="${MAP_TARGET}.bak"

if [ $DRYRUN -eq 1 ]; then
    echo "(dry-run) would write upstream:"
    if [ $REMOVE -eq 0 ]; then
        cat "$TMP_UPSTREAM"
    else
        echo "(dry-run) would remove $UPSTREAM_TARGET"
    fi
    echo "(dry-run) would write map to $MAP_TARGET with contents:"
    cat "$TMP_MAP"
    echo "(dry-run) would run: nginx -t && nginx -s reload"
    exit 0
fi

echo "Applying changes..."

# Validate generated map file does NOT contain a 'map' block header or braces
# The system expects a plain list of mapping lines like: username "username_pun_backend";
if grep -q "[{|}]" "$TMP_MAP" || grep -q "^map[[:space:]]" "$TMP_MAP"; then
    echo "ERROR: generated map file appears to contain a 'map' block or braces; aborting to avoid nginx parse errors." >&2
    rm -f "$TMP_UPSTREAM" "$TMP_MAP" || true
    exit 4
fi

# Backup existing upstream and map if present
if $SUDO_CMD test -f "$UPSTREAM_TARGET"; then
    echo "Backing up existing upstream to $UPSTREAM_BAK"
    $SUDO_CMD cp -p "$UPSTREAM_TARGET" "$UPSTREAM_BAK" || true
fi
if $SUDO_CMD test -f "$MAP_TARGET"; then
    echo "Backing up existing map to $MAP_BAK"
    $SUDO_CMD cp -p "$MAP_TARGET" "$MAP_BAK" || true
fi

if [ $REMOVE -eq 0 ]; then
    echo "Moving new upstream into place: $UPSTREAM_TARGET"
    $SUDO_CMD mv "$TMP_UPSTREAM" "$UPSTREAM_TARGET"
else
    echo "Removing upstream file: $UPSTREAM_TARGET"
    $SUDO_CMD rm -f "$UPSTREAM_TARGET" || true
fi

echo "Installing new map file"
$SUDO_CMD mv "$TMP_MAP" "$MAP_TARGET"

echo "Testing nginx configuration..."
if ! $SUDO_CMD /usr/sbin/nginx -t >/tmp/nginx-test.out 2>/tmp/nginx-test.err; then
    echo "nginx -t failed. Restoring backups..."
    # Try to restore backups
    if $SUDO_CMD test -f "$UPSTREAM_BAK"; then
        $SUDO_CMD mv -f "$UPSTREAM_BAK" "$UPSTREAM_TARGET" || true
    else
        $SUDO_CMD rm -f "$UPSTREAM_TARGET" || true
    fi
    if $SUDO_CMD test -f "$MAP_BAK"; then
        $SUDO_CMD mv -f "$MAP_BAK" "$MAP_TARGET" || true
    else
        $SUDO_CMD rm -f "$MAP_TARGET" || true
    fi
    echo "nginx test failed. See /tmp/nginx-test.err for details." >&2
    cat /tmp/nginx-test.err >&2 || true
    exit 3
fi

echo "nginx configuration OK. Reloading nginx..."
$SUDO_CMD /usr/sbin/nginx -s reload
echo "NGINX reloaded successfully."