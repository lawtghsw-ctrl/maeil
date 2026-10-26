export const DEMO_LOGIN_DOMAIN = "demo.lawpower.invalid";
// Keep the original provisioning contract and ready-marker validation fixed.
export const DEMO_LOGIN_IDS = ["test", "test1", "test2", "test3"] as const;
// Extra demo staff are created through account administration, not by reseeding.
export const DEMO_LOGIN_ALIASES = [...DEMO_LOGIN_IDS, "test4", "test5", "test6"] as const;

// Match the email syntax accepted by the previous type="email" login input.
const EMAIL_INPUT_PATTERN = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const LOGIN_ID_PATTERN = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/;

/** Syntax only. ID-to-account resolution stays on the server, including TEST IDs. */
export function parseLoginIdentifier(value: string): { kind: "email" | "id"; value: string } {
  const identifier = value.trim();
  if (identifier.length <= 254 && EMAIL_INPUT_PATTERN.test(identifier)) return { kind: "email", value: identifier };
  if (identifier.length <= 64 && LOGIN_ID_PATTERN.test(identifier)) return { kind: "id", value: identifier.toLowerCase() };
  throw new Error("올바른 아이디 또는 이메일을 입력해주세요.");
}

/** Accept only internal destinations, including after URL normalization/decoding. */
export function safeLoginNext(value: string | null): string | null {
  if (!value || !value.startsWith("/") || /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, "https://lawpower.invalid");
    if (url.origin !== "https://lawpower.invalid") return null;
    let pathname = url.pathname;
    for (let round = 0; round < 4; round++) {
      if (pathname.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(pathname)) return null;
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname) return url.pathname + url.search + url.hash;
      pathname = decoded;
    }
    return null;
  } catch {
    return null;
  }
}

/** Legacy demo provisioning addresses. Interactive login uses parseLoginIdentifier. */
export function normalizeLoginIdentifier(value: string): string {
  const identifier = value.trim();
  const alias = identifier.toLowerCase();
  if (DEMO_LOGIN_ALIASES.some((id) => id === alias)) return `${alias}@${DEMO_LOGIN_DOMAIN}`;
  if (EMAIL_INPUT_PATTERN.test(identifier)) return identifier;
  throw new Error("올바른 이메일 또는 아이디를 입력해주세요.");
}
