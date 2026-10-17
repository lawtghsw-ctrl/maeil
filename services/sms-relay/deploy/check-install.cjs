/* Offline only: source shell functions in child Bash, mock all host operations. */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = __dirname;
const installer = path.join(dir, 'install-relay.sh');
const bash = process.env.BASH_BINARY || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'lawpower-deploy-check-'));
let count = 0;
function check(name, fn) { fn(); count++; console.log(`ok ${count} - ${name}`); }
function shell(body) {
  return spawnSync(bash, ['--noprofile', '--norc', '-c', 'source "$INSTALLER"\n' + body], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, INSTALLER: installer.replaceAll('\\', '/'), FIXTURE: fixture.replaceAll('\\', '/') },
  });
}
function passed(body) { const r = shell(body); assert.equal(r.status, 0, r.stderr || r.error?.message); return r.stdout; }
function blocked(body, message) { const r = shell(body); assert.equal(r.status, 1, r.stderr || r.error?.message); assert.match(r.stderr, message); }
try {
  check('Bash syntax parses', () => {
    const r = spawnSync(bash, ['-n', installer.replaceAll('\\', '/')], { encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, 0, r.stderr || r.error?.message);
  });
  check('Rocky 9 and exact Ubuntu releases allowed', () => passed('supported_os rocky 9; supported_os rocky 9.4; supported_os ubuntu 22.04; supported_os ubuntu 24.04'));
  check('Other Linux and unsupported releases fail closed', () => passed('! supported_os rocky 8.10; ! supported_os ubuntu 20.04; ! supported_os ubuntu 24.10; ! supported_os debian 12; ! supported_os "" ""'));
  check('Only supported official binary architectures', () => passed('[[ "$(node_arch x86_64)" == x64 ]]; [[ "$(node_arch aarch64)" == arm64 ]]; ! node_arch i686'));
  check('Pinned Node official SHA-256 values', () => {
    const out = passed('printf "%s\\n" "$NODE_VERSION" "$(node_checksum x64)" "$(node_checksum arm64)"');
    assert.deepEqual(out.trim().split(/\r?\n/), ['24.22.0', '28ea0a438de9a13bd7891fd758eee6c7819ee8af5442dfd8d45bd65e56d4228c', 'b7e7991d5407815adfa74a2a9cd4db683552c8ce32ff4a295c22e972849c3f5d']);
  });
  check('DNS and IP certificate target input accepted', () => passed('valid_server_name isaack87.mycafe24.com; valid_server_name 139.162.80.95'));
  check('Unsafe/wildcard/URL hostnames rejected', () => passed('! valid_server_name "*.example.com"; ! valid_server_name "https://example.com"; ! valid_server_name "foo..bar.com"; ! valid_server_name ";include x;"; ! valid_server_name localhost'));
  check('Certificate path config injection rejected', () => passed('valid_cert_path /etc/letsencrypt/live/example.com/fullchain.pem; ! valid_cert_path "/tmp/a b"; ! valid_cert_path "/tmp/x;"; ! valid_cert_path "/tmp/../etc/x"'));
  check('Default invocation only calls inspection', () => {
    const out = passed('inspect_host() { echo INSPECTED; }; require_root() { exit 99; }; mktemp() { exit 98; }; main');
    assert.match(out, /INSPECTED/); assert.match(out, /No changes made/);
  });
  check('Explicit check stays read only', () => passed('inspect_host() { :; }; require_root() { exit 99; }; mktemp() { exit 98; }; main --check'));
  check('Ambiguous action rejected before host inspection', () => blocked('inspect_host() { exit 99; }; main --check --install', /Choose only one action/));
  check('Unknown option rejected before host inspection', () => blocked('inspect_host() { exit 99; }; main --enable-all', /Unknown option/));
  check('Missing option value rejected before host inspection', () => blocked('inspect_host() { exit 99; }; main --cert', /Missing value/));
  check('Free ports accepted with no service mutation', () => passed('ss() { :; }; systemctl() { exit 99; }; check_conflicts'));
  check('Existing APM port 80 blocks installation', () => blocked('ss() { [[ "$*" == *":80"* ]] && echo "LISTEN httpd"; return 0; }; systemctl() { return 1; }; check_conflicts', /Port 80 is occupied/));
  check('Foreign TLS listener blocks installation', () => blocked('ss() { [[ "$*" == *":443"* ]] && echo "LISTEN nginx"; return 0; }; systemctl() { return 1; }; check_conflicts', /Port 443 is occupied/));
  check('Foreign loopback relay listener blocks installation', () => blocked('ss() { [[ "$*" == *":8787"* ]] && echo "LISTEN node"; return 0; }; systemctl() { return 1; }; check_conflicts', /Port 8787 is occupied/));
  check('Hidden listener PID is not trusted as managed service', () => blocked('ss() { [[ "$*" == *":443"* ]] && echo "LISTEN no-pid"; return 0; }; systemctl() { return 0; }; check_conflicts', /Cannot establish ownership/));
  check('Absent certificates block before nginx configuration', () => blocked('configure_https example.com /lawpower-test-absent/cert.pem /lawpower-test-absent/key.pem', /must exist/));
  check('Unsafe hostname blocks before certificate access', () => blocked('configure_https "example.com;include" /etc/x /etc/y', /Expected a lowercase/));
  fs.writeFileSync(path.join(fixture, 'cert.pem'), 'FAKE TEST CERTIFICATE');
  fs.writeFileSync(path.join(fixture, 'key.pem'), 'FAKE TEST KEY');
  check('Expired/invalid certificate cannot create config', () => blocked('f="$(cd "$FIXTURE" && pwd -P)"; openssl() { return 1; }; configure_https example.com "$f/cert.pem" "$f/key.pem"', /Certificate expired/));
  const service = fs.readFileSync(path.join(dir, 'lawpower-sms-relay.service'), 'utf8');
  const gateway = fs.readFileSync(path.join(dir, 'lawpower-sms-relay-gateway.service'), 'utf8');
  const nginx = fs.readFileSync(path.join(dir, 'nginx.conf.template'), 'utf8');
  const script = fs.readFileSync(installer, 'utf8');
  check('Relay fixed loopback, non-root, bounded resources', () => {
    assert.match(service, /^User=lawpower-sms-relay$/m);
    assert.match(service, /^ExecStart=\/usr\/bin\/env RELAY_HOST=127\.0\.0\.1 RELAY_PORT=8787 /m);
    assert.match(service, /^MemoryMax=256M$/m); assert.match(service, /^ProtectSystem=strict$/m);
    assert.doesNotMatch(service, /MemoryDenyWriteExecute|StateDirectory/);
  });
  check('Gateway uses only dedicated verified config and units', () => {
    assert.match(gateway, /ConditionPathExists=\/etc\/lawpower-sms-relay\/nginx.conf/);
    assert.match(gateway, /ExecStartPre=\/usr\/sbin\/nginx -t -q -c \/etc\/lawpower-sms-relay\/nginx.conf/);
    assert.doesNotMatch(gateway, /\/etc\/nginx\/nginx.conf|ExecStart=.*systemctl/);
  });
  check('HTTPS only, exact test route, no access/body logging', () => {
    assert.match(nginx, /listen 443 ssl;/); assert.doesNotMatch(nginx, /listen (?:[^;\n]*:)?80[ ;]/);
    assert.match(nginx, /location = \/v1\/aligo\/test/); assert.match(nginx, /request_method != POST/);
    assert.match(nginx, /access_log off;/); assert.match(nginx, /error_log \/dev\/null crit;/); assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:8787;/);
    assert.match(nginx, /location = \/health/); assert.match(nginx, /request_method != GET/);
    assert.match(nginx, /location \/ \{ return 404; \}/); assert.doesNotMatch(nginx, /^\s*include\s/m);
  });
  check('Installer never starts services or changes firewall/swap/SELinux', () => {
    const code = script.split('\n').filter(x => !x.trim().startsWith('#')).join('\n');
    assert.doesNotMatch(code, /systemctl\s+(start|restart|reload|enable|disable|stop)|(?:^|\n)\s*(?:setenforce|setsebool|swapon|mkswap|iptables|nft)\s|firewall-cmd[^\n]*(?:--add|--remove)|curl[^\n]*\|\s*(?:ba)?sh/);
    assert.match(script, /sha256sum --check --status/);
    assert.match(script, /chmod -R a\+rX,go-w/);
    assert.match(script, /cmp -s "\$source" "\$destination" \|\| fail/);
  });
  console.log(`PASS ${count} offline deployment checks; no server, package, service or network operations.`);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
