export const DEMO_LOGIN_DOMAIN = "demo.lawpower.invalid";
// Keep the original provisioning contract and ready-marker validation fixed.
export const DEMO_LOGIN_IDS = ["test", "test1", "test2", "test3"] as const;
// Extra demo staff are created through account administration, not by reseeding.
export const DEMO_LOGIN_ALIASES = [...DEMO_LOGIN_IDS, "test4", "test5", "test6"] as const;

// Match the email syntax accepted by the previous type="email" login input.
const EMAIL_INPUT_PATTERN = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/** Resolve only known demo aliases; authentication and account checks still run normally. */
export function normalizeLoginIdentifier(value: string): string {
  const identifier = value.trim();
  const alias = identifier.toLowerCase();
  if (DEMO_LOGIN_ALIASES.some((id) => id === alias)) return `${alias}@${DEMO_LOGIN_DOMAIN}`;
  if (EMAIL_INPUT_PATTERN.test(identifier)) return identifier;
  throw new Error("올바른 이메일 또는 아이디를 입력해주세요.");
}
