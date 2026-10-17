#!/usr/bin/env bash
# Reviewable, explicit installation only. No SMS request or service start here.
set -Eeuo pipefail
umask 077

readonly NODE_VERSION='24.22.0'
readonly APP_ROOT='/opt/lawpower-sms-relay'
readonly CONFIG_ROOT='/etc/lawpower-sms-relay'
readonly SERVICE_USER='lawpower-sms-relay'
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
POLICY_CREATED=0
WORK_DIR=''

fail() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
note() { printf '%s\n' "$*"; }

supported_os() {
    case "$1:$2" in ubuntu:22.04|ubuntu:24.04|rocky:9|rocky:9.*) return 0 ;; *) return 1 ;; esac
}
node_arch() {
    case "$1" in x86_64) printf x64 ;; aarch64|arm64) printf arm64 ;; *) return 1 ;; esac
}
node_checksum() {
    case "$1" in
        x64) printf '28ea0a438de9a13bd7891fd758eee6c7819ee8af5442dfd8d45bd65e56d4228c' ;;
        arm64) printf 'b7e7991d5407815adfa74a2a9cd4db683552c8ce32ff4a295c22e972849c3f5d' ;;
        *) return 1 ;;
    esac
}
valid_server_name() {
    # ASCII DNS name or IPv4; no wildcards, URLs, whitespace, or config metacharacters.
    [[ "$1" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] && [[ "$1" == *.* ]] &&
        [[ "$1" != *..* && "$1" != *.-* && "$1" != *-.* && ${#1} -le 253 ]]
}
valid_cert_path() { [[ "$1" =~ ^/[A-Za-z0-9_./-]+$ ]] && [[ "$1" != *'/../'* ]]; }

cleanup() {
    # Remove only our temporary policy; never touch one that existed beforehand.
    if [[ "$POLICY_CREATED" == 1 ]] && [[ -f /usr/sbin/policy-rc.d ]] &&
        grep -q '^# lawpower-sms-relay temporary package policy$' /usr/sbin/policy-rc.d; then
        rm -- /usr/sbin/policy-rc.d
    fi
    if [[ -n "$WORK_DIR" && "$WORK_DIR" == /tmp/lawpower-relay-install.* && -d "$WORK_DIR" ]]; then
        rm -rf -- "$WORK_DIR"
    fi
}

inspect_host() {
    [[ "$(uname -s)" == Linux ]] || fail 'Linux host required; do not run this installer on Windows.'
    [[ -r /etc/os-release ]] || fail '/etc/os-release is missing.'
    # Trusted local OS metadata, not an SSH banner or user-supplied file.
    . /etc/os-release
    supported_os "${ID:-}" "${VERSION_ID:-}" || fail "Unsupported OS: ${ID:-unknown} ${VERSION_ID:-unknown}. Allowed: Rocky 9.x, Ubuntu 22.04/24.04."
    OS_ID="$ID"
    ARCH="$(node_arch "$(uname -m)")" || fail 'Only x86_64 and aarch64 are supported.'
    command -v systemctl >/dev/null || fail 'systemd is required.'
    [[ -d /run/systemd/system ]] || fail 'systemd must be the running service manager.'
    command -v ss >/dev/null || fail 'ss is required for conflict checks (iproute/iproute2).'
    note "OS: $PRETTY_NAME | architecture: $ARCH"
    note 'Existing listeners (read only):'
    ss -ltnp '( sport = :22 or sport = :80 or sport = :443 or sport = :8787 )'
    note 'Existing service states (read only):'
    for service in sshd ssh httpd apache2 mariadb mysqld nginx firewalld lawpower-sms-relay lawpower-sms-relay-gateway; do
        printf '%s: ' "$service"; systemctl is-active "$service" 2>/dev/null || true
    done
    note "SELinux: $(command -v getenforce >/dev/null && getenforce || printf 'not installed')"
    if command -v getsebool >/dev/null; then getsebool httpd_can_network_connect 2>/dev/null || true; fi
    if command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
        firewall-cmd --get-active-zones
        firewall-cmd --list-all
    fi
    note 'Memory / existing swap (never changed):'
    free -m
    cat /proc/swaps
    check_conflicts
}

check_conflicts() {
    local sockets port
    for port in 80 443 8787; do
        sockets="$(ss -H -ltnp "sport = :$port")"
        [[ -z "$sockets" ]] && continue
        # Re-runs may inspect our already running units; their exact cgroup must own every listener.
        local expected=''
        [[ "$port" == 443 ]] && expected='lawpower-sms-relay-gateway.service'
        [[ "$port" == 8787 ]] && expected='lawpower-sms-relay.service'
        if [[ -n "$expected" ]] && systemctl is-active --quiet "$expected"; then
            local pids pid found=0
            pids="$(printf '%s' "$sockets" | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
            [[ -n "$pids" ]] || fail "Cannot establish ownership of port $port. Run the check as root."
            while read -r pid; do
                grep -Fq "/$expected" "/proc/$pid/cgroup" || fail "Foreign process listens on port $port. Existing services were not changed."
                found=1
            done <<< "$pids"
            [[ "$found" == 1 ]] && continue
        fi
        printf '%s\n' "$sockets" >&2
        fail "Port $port is occupied. Resolve the existing APM/web-server conflict separately; nothing has been stopped."
    done
}

require_root() { [[ "$(id -u)" == 0 ]] || fail 'Use sudo for --install or --configure-https.'; }
ensure_directory() {
    local target="$1" mode="$2"
    [[ ! -L "$target" ]] || fail "Refusing symlink directory: $target"
    if [[ -e "$target" ]]; then
        [[ -d "$target" && "$(stat -c %u "$target")" == 0 ]] || fail "Directory must be root-owned: $target"
        [[ "$(stat -c %a "$target")" == "$mode" ]] || fail "Existing directory mode must be $mode (not changed): $target"
    else
        install -d -o root -g root -m "$mode" "$target"
    fi
}
install_once() {
    local source="$1" destination="$2" mode="$3"
    [[ ! -L "$destination" ]] || fail "Refusing symlink target: $destination"
    if [[ -e "$destination" ]]; then
        cmp -s "$source" "$destination" || fail "Existing file differs; review it manually (not overwritten): $destination"
        [[ "$(stat -c %u "$destination")" == 0 && "$(stat -c %a "$destination")" == "$mode" ]] || fail "Unexpected owner/mode (not changed): $destination"
    else
        install -o root -g root -m "$mode" "$source" "$destination"
    fi
}

install_packages() {
    if [[ "$OS_ID" == ubuntu ]]; then
        # apt postinst must not start nginx's unrelated public default site.
        [[ ! -e /usr/sbin/policy-rc.d && ! -L /usr/sbin/policy-rc.d ]] || fail 'Existing policy-rc.d preserved; ask the operator to install nginx/curl/ca-certificates without starting services, then rerun.'
        (set -o noclobber; printf '#!/bin/sh\n# lawpower-sms-relay temporary package policy\nexit 101\n' > /usr/sbin/policy-rc.d) || fail 'Cannot create temporary package policy safely.'
        POLICY_CREATED=1
        chmod 755 /usr/sbin/policy-rc.d
        DEBIAN_FRONTEND=noninteractive apt-get update
        DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nginx curl ca-certificates
        rm -- /usr/sbin/policy-rc.d
        POLICY_CREATED=0
    else
        dnf install -y nginx curl ca-certificates
    fi
    # Distro nginx and all existing sites stay untouched and unstarted.
    check_conflicts
}

install_node() {
    local version_dir="$APP_ROOT/node-v$NODE_VERSION" archive name expected
    name="node-v$NODE_VERSION-linux-$ARCH.tar.gz"
    expected="$(node_checksum "$ARCH")"
    if [[ -e "$version_dir" || -L "$version_dir" ]]; then
        [[ -d "$version_dir" && ! -L "$version_dir" && -f "$version_dir/.lawpower-official-sha256" ]] || fail 'Existing Node directory is not a managed installation.'
        [[ -z "$(find "$version_dir" \( ! -user root -o \( ! -type l -perm /022 \) \) -print -quit)" ]] || fail 'Existing Node tree is not exclusively root-controlled.'
        [[ -f "$version_dir/bin/node" && ! -L "$version_dir/bin/node" ]] || fail 'Existing Node binary must be a regular file.'
        [[ "$(cat "$version_dir/.lawpower-official-sha256")" == "$expected" ]] || fail 'Existing Node checksum marker differs.'
        [[ "$("$version_dir/bin/node" --version)" == "v$NODE_VERSION" ]] || fail 'Existing Node version differs.'
    else
        archive="$WORK_DIR/$name"
        curl --proto '=https' --tlsv1.2 --fail --show-error --silent --location --max-time 180 --output "$archive" "https://nodejs.org/dist/v$NODE_VERSION/$name"
        printf '%s  %s\n' "$expected" "$archive" | sha256sum --check --status || fail 'Official Node archive checksum mismatch; archive was not executed or extracted.'
        mkdir "$WORK_DIR/node"
        tar -xzf "$archive" --strip-components=1 --no-same-owner -C "$WORK_DIR/node"
        [[ "$("$WORK_DIR/node/bin/node" --version)" == "v$NODE_VERSION" ]] || fail 'Downloaded Node version differs.'
        printf '%s\n' "$expected" > "$WORK_DIR/node/.lawpower-official-sha256"
        chown -R root:root "$WORK_DIR/node"
        # The installer's restrictive umask must not make Node unreadable to its service user.
        chmod -R a+rX,go-w "$WORK_DIR/node"
        # Same filesystem is not required; cp only to the previously absent, dedicated path.
        cp -a "$WORK_DIR/node" "$version_dir"
    fi
    if [[ -L "$APP_ROOT/node" ]]; then
        [[ "$(readlink "$APP_ROOT/node")" == "node-v$NODE_VERSION" ]] || fail 'Existing Node symlink differs (not replaced).'
    elif [[ -e "$APP_ROOT/node" ]]; then
        fail 'Existing Node path is not our expected symlink.'
    else
        ln -s "node-v$NODE_VERSION" "$APP_ROOT/node"
    fi
}

install_application() {
    local source="$1" passwd_entry
    [[ -f "$source/src/server.mjs" && ! -L "$source/src" ]] || fail 'Source must contain src/server.mjs.'
    [[ -z "$(find "$source/src" -type l -print -quit)" ]] || fail 'Source symlinks are not allowed.'
    if getent passwd "$SERVICE_USER" >/dev/null; then
        passwd_entry="$(getent passwd "$SERVICE_USER")"
        [[ "$(id -u "$SERVICE_USER")" != 0 ]] || fail 'Service account must not have uid 0.'
        [[ "$(printf '%s' "$passwd_entry" | cut -d: -f6)" == /nonexistent ]] || fail 'Existing service account has an unexpected home; not changed.'
        [[ "$(printf '%s' "$passwd_entry" | cut -d: -f7)" == */nologin ]] || fail 'Existing service account is not nologin; not changed.'
        [[ "$(id -gn "$SERVICE_USER")" == "$SERVICE_USER" && "$(id -Gn "$SERVICE_USER")" == "$SERVICE_USER" ]] || fail 'Existing service user groups differ; not changed.'
    else
        getent group "$SERVICE_USER" >/dev/null && fail 'Service group already exists without its user; not changed.'
        useradd --system --user-group --home-dir /nonexistent --no-create-home --shell "$(command -v nologin)" "$SERVICE_USER"
    fi
    if [[ -e "$APP_ROOT/app" || -L "$APP_ROOT/app" ]]; then
        [[ -d "$APP_ROOT/app/src" && ! -L "$APP_ROOT/app" && ! -L "$APP_ROOT/app/src" ]] || fail 'Unexpected existing application path.'
        diff -qr "$source/src" "$APP_ROOT/app/src" >/dev/null || fail 'Installed source differs; no files overwritten. Review an explicit upgrade separately.'
    else
        install -d -o root -g root -m 755 "$APP_ROOT/app"
        cp -R "$source/src" "$APP_ROOT/app/src"
        chown -R root:root "$APP_ROOT/app"
        find "$APP_ROOT/app" -type d -exec chmod 755 {} +
        find "$APP_ROOT/app" -type f -exec chmod 644 {} +
    fi
    if [[ -e "$CONFIG_ROOT/relay.env" || -L "$CONFIG_ROOT/relay.env" ]]; then
        [[ -f "$CONFIG_ROOT/relay.env" && ! -L "$CONFIG_ROOT/relay.env" && "$(stat -c %u "$CONFIG_ROOT/relay.env")" == 0 && "$(stat -c %a "$CONFIG_ROOT/relay.env")" == 600 ]] || fail 'relay.env must be a regular root-owned 0600 file; contents were not read or changed.'
    else
        install -o root -g root -m 600 "$source/relay.env.example" "$CONFIG_ROOT/relay.env"
    fi
    install_once "$SCRIPT_DIR/lawpower-sms-relay.service" /etc/systemd/system/lawpower-sms-relay.service 644
    install_once "$SCRIPT_DIR/lawpower-sms-relay-gateway.service" /etc/systemd/system/lawpower-sms-relay-gateway.service 644
    install_once "$SCRIPT_DIR/lawpower-sms-worker.service" /etc/systemd/system/lawpower-sms-worker.service 644
    install_once "$SCRIPT_DIR/lawpower-sms-worker.timer" /etc/systemd/system/lawpower-sms-worker.timer 644
    if [[ -e "$CONFIG_ROOT/worker.curl" || -L "$CONFIG_ROOT/worker.curl" ]]; then
        [[ -f "$CONFIG_ROOT/worker.curl" && ! -L "$CONFIG_ROOT/worker.curl" && "$(stat -c %u "$CONFIG_ROOT/worker.curl")" == 0 && "$(stat -c %a "$CONFIG_ROOT/worker.curl")" == 600 ]] || fail 'worker.curl must be a regular root-owned 0600 file; contents were not read or changed.'
    else
        install -o root -g root -m 600 "$SCRIPT_DIR/worker.curl.example" "$CONFIG_ROOT/worker.curl"
    fi
    systemctl daemon-reload
}

configure_https() {
    local server_name="$1" cert="$2" key="$3" cert_pub key_pub
    valid_server_name "$server_name" || fail 'Expected a lowercase DNS hostname or IPv4 address, not a URL.'
    valid_cert_path "$cert" && valid_cert_path "$key" || fail 'Certificate paths must be absolute, without spaces/metacharacters.'
    [[ -f "$cert" && -f "$key" ]] || fail 'A real certificate and private key must exist before gateway configuration.'
    command -v openssl >/dev/null || fail 'openssl is required to validate TLS files; install it explicitly first.'
    openssl x509 -in "$cert" -noout -checkend 86400 >/dev/null || fail 'Certificate expired or has less than 24 hours left.'
    if [[ "$server_name" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        openssl x509 -in "$cert" -noout -checkip "$server_name" >/dev/null || fail 'Certificate does not cover this IP address.'
    else
        openssl x509 -in "$cert" -noout -checkhost "$server_name" >/dev/null || fail 'Certificate does not cover this hostname.'
    fi
    openssl verify -purpose sslserver -untrusted "$cert" "$cert" >/dev/null || fail 'Certificate chain is not trusted by the OS CA store.'
    [[ "$(stat -Lc %u "$key")" == 0 && "$(stat -Lc %a "$key")" == 600 ]] || fail 'Private key target must be root-owned 0600 (not modified).'
    cert_pub="$(openssl x509 -in "$cert" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum | cut -d' ' -f1)"
    key_pub="$(openssl pkey -in "$key" -passin pass: -pubout -outform DER | sha256sum | cut -d' ' -f1)"
    [[ "$cert_pub" == "$key_pub" ]] || fail 'Certificate and private key do not match.'
    if command -v getenforce >/dev/null && [[ "$(getenforce)" == Enforcing ]]; then
        getsebool httpd_can_network_connect | grep -q -- '--> on$' || fail 'SELinux blocks proxy connections. Review the RHEL reverse-proxy policy separately; this installer never disables SELinux or changes global booleans.'
    fi
    [[ -x /usr/sbin/nginx && -d "$CONFIG_ROOT" ]] || fail 'Run --install first.'
    sed -e "s|__SERVER_NAME__|$server_name|g" -e "s|__CERT_PATH__|$cert|g" -e "s|__KEY_PATH__|$key|g" "$SCRIPT_DIR/nginx.conf.template" > "$WORK_DIR/nginx.conf"
    # Test with a temporary PID path; the systemd RuntimeDirectory exists only after service start.
    sed "s|/run/lawpower-sms-relay-gateway/nginx.pid|$WORK_DIR/nginx.pid|g" "$WORK_DIR/nginx.conf" > "$WORK_DIR/nginx-check.conf"
    /usr/sbin/nginx -t -q -c "$WORK_DIR/nginx-check.conf" -e /dev/null
    install_once "$WORK_DIR/nginx.conf" "$CONFIG_ROOT/nginx.conf" 644
    note 'HTTPS config verified and installed. No service started, enabled, reloaded, or firewall rule changed.'
}

usage() {
    cat <<'USAGE'
Usage (default is read-only --check):
  sudo bash deploy/install-relay.sh --check
  sudo bash deploy/install-relay.sh --install [--source /absolute/sms-relay]
  sudo bash deploy/install-relay.sh --configure-https --server-name isaack87.mycafe24.com --cert /etc/letsencrypt/live/isaack87.mycafe24.com/fullchain.pem --key /etc/letsencrypt/live/isaack87.mycafe24.com/privkey.pem
Supports Rocky Linux 9.x and Ubuntu 22.04/24.04. Never starts/enables services,
sends a request, issues a certificate, changes SELinux/firewall/SSH/swap, or
overwrites an existing application/configuration. Read deploy/README.md first.
USAGE
}
main() {
    local action=check selected=0 source server_name='' cert='' key=''
    source="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
    while (($#)); do
        case "$1" in
            --check|--install|--configure-https)
                [[ "$selected" == 0 ]] || fail 'Choose only one action.'
                action="${1#--}"; selected=1; shift ;;
            --source|--server-name|--cert|--key)
                [[ $# -ge 2 ]] || fail "Missing value for $1"
                case "$1" in --source) source="$2" ;; --server-name) server_name="$2" ;; --cert) cert="$2" ;; --key) key="$2" ;; esac
                shift 2 ;;
            -h|--help) usage; return ;;
            *) fail "Unknown option: $1" ;;
        esac
    done
    inspect_host
    [[ "$action" != check ]] || { note 'Read-only checks passed. No changes made.'; return; }
    require_root
    trap cleanup EXIT
    WORK_DIR="$(mktemp -d /tmp/lawpower-relay-install.XXXXXXXX)"
    if [[ "$action" == install ]]; then
        [[ "$source" == /* && -f "$source/src/server.mjs" && -f "$source/relay.env.example" ]] || fail 'Valid absolute --source directory required.'
        # Fail before package mutation if dedicated paths are already owned by something else.
        ensure_directory "$APP_ROOT" 755
        ensure_directory "$CONFIG_ROOT" 700
        if ! command -v curl >/dev/null || [[ ! -x /usr/sbin/nginx ]] || [[ ! -s /etc/ssl/certs/ca-certificates.crt && ! -s /etc/pki/tls/certs/ca-bundle.crt ]]; then install_packages; fi
        install_node
        install_application "$source"
        note 'Installation staged. Fill relay.env securely, then follow deploy/README.md. Nothing is running or enabled by this installer.'
    else
        [[ -n "$server_name" && -n "$cert" && -n "$key" ]] || fail '--configure-https requires --server-name, --cert and --key.'
        configure_https "$server_name" "$cert" "$key"
    fi
}
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
