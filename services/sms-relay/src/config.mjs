export const BODY_LIMIT_BYTES = 4096;
export const UPSTREAM_TIMEOUT_MS = 10_000;
export const DUPLICATE_TTL_MS = 10 * 60_000;
export const DUPLICATE_CAPACITY = 1000;
export const PHONE_PATTERN = /^[0-9]{8,16}$/;
export const RECEIVER_PATTERN = /^01[016789]\d{7,8}$/;

export function validProvider(provider) {
  return provider && typeof provider === "object" && !Array.isArray(provider) && Object.keys(provider).length === 2 &&
    Object.hasOwn(provider, "key") && Object.hasOwn(provider, "userId") &&
    typeof provider.key === "string" && /^[\x21-\x7E]{1,256}$/.test(provider.key) &&
    typeof provider.userId === "string" && /^[A-Za-z0-9_.@-]{1,128}$/.test(provider.userId);
}

function integer(value, fallback, min, max, name) {
  if (value === undefined || value === "") return fallback;
  if (!/^[0-9]+$/.test(value)) throw new Error(`${name} must be an integer.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${name} is outside the permitted range.`);
  return number;
}
function required(env, name, max) {
  const value = env[name];
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1F\x7F]/.test(value)) throw new Error(`${name} must be configured.`);
  return value.trim();
}
export function readConfig(env = process.env) {
  const token = required(env, "RELAY_BEARER_TOKEN", 256);
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error("RELAY_BEARER_TOKEN must contain 32–256 URL-safe characters.");
  const credentialSource = env.ALIGO_CREDENTIAL_SOURCE || "server-env";
  if (!["server-env", "request"].includes(credentialSource)) throw new Error("ALIGO_CREDENTIAL_SOURCE must be server-env or request.");
  let apiKey, userId;
  if (credentialSource === "server-env") {
    apiKey = required(env, "ALIGO_API_KEY", 256);
    userId = required(env, "ALIGO_USER_ID", 128);
    if (!validProvider({ key: apiKey, userId })) throw new Error("Aligo environment credentials have an invalid format.");
  }
  const senderValues = required(env, "ALIGO_SENDER_ALLOWLIST", 512).split(",").map((value) => value.trim());
  if (!senderValues.length || senderValues.length > 20 || senderValues.some((value) => !PHONE_PATTERN.test(value))) throw new Error("ALIGO_SENDER_ALLOWLIST must contain registered numeric senders.");
  const host = env.RELAY_HOST || "127.0.0.1";
  if (!["127.0.0.1", "::1"].includes(host)) throw new Error("RELAY_HOST must be a loopback address.");
  return Object.freeze({
    token, apiKey, userId, credentialSource, allowedSenders: new Set(senderValues), host,
    port: integer(env.RELAY_PORT, 8787, 1, 65535, "RELAY_PORT"),
    maxConcurrency: integer(env.RELAY_MAX_CONCURRENCY, 2, 1, 4, "RELAY_MAX_CONCURRENCY"),
  });
}
