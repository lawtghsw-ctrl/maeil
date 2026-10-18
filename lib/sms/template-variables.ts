/** A consultation application's requested slot, never a guessed appointment. */
export function smsConsultTime(data: { consultTime?: unknown; consultTimeRaw?: unknown } | undefined): string {
  const value = typeof data?.consultTime === "string" && data.consultTime.trim() ? data.consultTime : data?.consultTimeRaw;
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200) : "";
}

/** Keep the existing name/staff replacements and resolve only the new slot tokens. */
export function renderSmsTemplate(template: string, recipient: { name?: string; consultTime?: string }, staff?: string): string {
  return template.replaceAll("{고객명}", recipient.name || "고객")
    .replaceAll("{담당자}", staff || "담당자")
    .replaceAll("{상담시간대}", recipient.consultTime?.trim() || "미지정")
    .replaceAll("{상담시간}", recipient.consultTime?.trim() || "미지정");
}
