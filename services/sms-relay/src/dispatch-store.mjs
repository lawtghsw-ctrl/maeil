import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, writeSync, chmodSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

function syncDirectory(path) {
  // Windows cannot open directories through this API; the production host is Linux.
  if (process.platform === 'win32') return;
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function unknownOutcome(dispatchId) {
  return { status: 200, body: { ok: false, testMode: false, actualDelivery: null, dispatchId, state: 'unknown', providerCode: null,
    providerMessage: '발송 결과를 확인할 수 없습니다. 같은 요청은 다시 발송하지 않습니다.', messageId: null, retryable: false } };
}

/** Contains only keyed hashes and sanitized outcomes, never messages or contacts. */
export class DispatchStore {
  constructor(path) {
    if (!isAbsolute(path) || !existsSync(dirname(path))) throw new Error('STATE_DIRECTORY_REQUIRED');
    const keyPath = `${path}.hmac-key`;
    const existed = existsSync(path), keyExisted = existsSync(keyPath);
    if (existed !== keyExisted) throw new Error('STATE_PAIR_INCOMPLETE');
    if (existed && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || !lstatSync(keyPath).isFile() || lstatSync(keyPath).isSymbolicLink())) throw new Error('INVALID_STATE_FILES');
    if (!existed) {
      // Exclusive creation avoids two processes silently selecting different keys.
      const fd = openSync(path, 'wx', 0o600);
      try { fsyncSync(fd); } finally { closeSync(fd); }
      const keyFd = openSync(keyPath, 'wx', 0o600);
      try { writeSync(keyFd, randomBytes(32)); fsyncSync(keyFd); } finally { closeSync(keyFd); }
      syncDirectory(dirname(path));
    }
    this.key = readFileSync(keyPath);
    if (this.key.length !== 32) throw new Error('INVALID_STATE_KEY');
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    this.db = new DatabaseSync(path, { timeout: 1000, enableForeignKeyConstraints: true, allowExtension: false });
    try {
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000; PRAGMA trusted_schema=OFF;');
      if (!existed) {
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK (id=1), version INTEGER NOT NULL, key_check TEXT NOT NULL);
          CREATE TABLE dispatches (
            dispatch_id TEXT PRIMARY KEY, approval_epoch TEXT NOT NULL, payload_hash TEXT NOT NULL,
            provider_hash TEXT NOT NULL, receiver_hash TEXT NOT NULL, state TEXT NOT NULL,
            http_status INTEGER NOT NULL, response_json TEXT NOT NULL, message_id TEXT,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
          );`);
        this.db.prepare('INSERT INTO metadata VALUES (1, 1, ?)').run(this.hash('state-key-check', 'v1'));
        this.db.exec('COMMIT');
        syncDirectory(dirname(path));
      }
      const metadata = this.db.prepare('SELECT version, key_check FROM metadata WHERE id=1').get();
      if (metadata?.version !== 1 || metadata.key_check !== this.hash('state-key-check', 'v1')) throw new Error('STATE_KEY_MISMATCH');
      // A previous process may have stopped after its committed attempt. Never
      // infer that a missing acknowledgement means the provider did not send.
      this.db.prepare("UPDATE dispatches SET state='unknown' WHERE state='started'").run();
      chmodSync(path, 0o600); chmodSync(keyPath, 0o600);
    } catch {
      try { this.db.exec('ROLLBACK'); } catch { /* No active transaction. */ }
      this.db.close(); throw new Error('STATE_INITIALIZATION_FAILED');
    }
  }
  hash(purpose, value) { return createHmac('sha256', this.key).update(purpose).update('\0').update(value).digest('hex'); }
  providerHash(provider) { return this.hash('provider', JSON.stringify([provider.key, provider.userId])); }
  receiverHash(receiver) { return this.hash('receiver', receiver); }
  checkReady() { return this.db.prepare('SELECT version FROM metadata WHERE id=1').get()?.version === 1; }
  fingerprint(body) {
    return this.hash('payload', JSON.stringify([
      body.approvalEpoch, body.sender, body.receiver, body.message, body.msgType, body.title || '',
      body.images.map(image => [image.filename, image.contentType, createHash('sha256').update(image.bytes).digest('hex')]),
      this.providerHash(body.provider),
    ]));
  }
  get(dispatchId) { return this.db.prepare('SELECT * FROM dispatches WHERE dispatch_id=?').get(dispatchId); }
  outcome(row) { return { status: row.http_status, body: JSON.parse(row.response_json) }; }
  claim(body, payloadHash) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.get(body.dispatchId);
      if (existing) { this.db.exec('COMMIT'); return { created: false, row: existing }; }
      const outcome = unknownOutcome(body.dispatchId), now = Date.now();
      this.db.prepare(`INSERT INTO dispatches (dispatch_id,approval_epoch,payload_hash,provider_hash,receiver_hash,state,http_status,response_json,message_id,created_at,updated_at)
        VALUES (?,?,?,?,?,'started',?,?,NULL,?,?)`).run(body.dispatchId, body.approvalEpoch, payloadHash, this.providerHash(body.provider), this.receiverHash(body.receiver), outcome.status, JSON.stringify(outcome.body), now, now);
      // FULL synchronous COMMIT is the barrier before any provider call.
      this.db.exec('COMMIT');
      return { created: true, row: this.get(body.dispatchId) };
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch { /* Already committed. */ } throw error; }
  }
  finish(dispatchId, payloadHash, outcome) {
    this.db.prepare('UPDATE dispatches SET state=?,http_status=?,response_json=?,message_id=?,updated_at=? WHERE dispatch_id=? AND payload_hash=?')
      .run(outcome.body.state, outcome.status, JSON.stringify(outcome.body), outcome.body.messageId, Date.now(), dispatchId, payloadHash);
  }
  recordDelivery(row, outcome) {
    // A later or concurrent poll must never regress a confirmed terminal result.
    this.db.prepare("UPDATE dispatches SET state=?,http_status=?,response_json=?,updated_at=? WHERE dispatch_id=? AND payload_hash=? AND state NOT IN ('delivered','failed','rejected')")
      .run(outcome.body.state, outcome.status, JSON.stringify(outcome.body), Date.now(), row.dispatch_id, row.payload_hash);
    return this.outcome(this.get(row.dispatch_id));
  }
  close() { this.db.close(); this.key.fill(0); }
}
