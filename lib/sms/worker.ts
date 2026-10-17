import { APPROVED_SENDERS, MOBILE, UUID, type DeliveryJob, type SmsAdmin, readGate, readLiveConfiguration } from "./delivery";
import { loadImages } from "./media";
import { validateMessage } from "@/services/sms-relay/src/validation.mjs";

type Configuration = ReturnType<typeof readLiveConfiguration>;
type Outcome = { state?: unknown; dispatchId?: unknown; testMode?: unknown; messageId?: unknown; providerCode?: unknown; error?: unknown };
const providerId = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{0,19}$/.test(value);
const providerCode = (value: unknown) => Number.isSafeInteger(value) ? value as number : null;

async function relay(configuration: Configuration, endpoint: "send" | "results", body: Record<string, unknown>): Promise<Outcome> {
  const response = await fetch(`${configuration.origin}/v1/aligo/${endpoint}`, {
    method: "POST", headers: { authorization: `Bearer ${configuration.token}`, "content-type": "application/json" },
    body: JSON.stringify(body), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000),
  });
  // A transport/proxy failure cannot establish whether a provider request occurred.
  if (!response.ok) throw new Error("RELAY_OUTCOME_UNKNOWN");
  const text = await response.text();
  if (text.length > 16_384) throw new Error("RELAY_OUTCOME_UNKNOWN");
  const result: unknown = JSON.parse(text);
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("RELAY_OUTCOME_UNKNOWN");
  return result as Outcome;
}

async function stillAllowed(admin: SmsAdmin, job: DeliveryJob): Promise<boolean> {
  const gate = await readGate(admin, job.law_firm_id);
  if (!gate || gate.epoch_id !== job.epoch_id || gate.relay_epoch !== job.relay_epoch ||
      !(job.source === "new_lead" || job.source === "absence" ? gate.auto_enabled : gate.manual_enabled)) return false;
  const [{data: firm,error: firmError},{data: sender,error: senderError}] = await Promise.all([
    admin.from("law_firms").select("status,name,firm_code").eq("id",job.law_firm_id).maybeSingle(),
    admin.from("sms_sender_numbers").select("phone,is_active,is_registered").eq("id",job.sender_number_id).eq("law_firm_id",job.law_firm_id).maybeSingle(),
  ]);
  return !firmError && !senderError && !!firm && firm.status === "active" && !(firm.name === "TEST" && firm.firm_code === "0000000000") &&
    !!sender && sender.is_active === true && sender.is_registered === true && sender.phone === job.sender_number && APPROVED_SENDERS.has(sender.phone);
}

async function processJob(admin: SmsAdmin, configuration: Configuration, job: DeliveryJob) {
  if (!job.attempt_id || !UUID.test(job.attempt_id)) throw new Error("INVALID_CLAIM");
  let outcome: "accepted" | "failed" | "unknown" = "failed", errorCode: string | null = "PREFLIGHT_REJECTED";
  let messageId: string | null = null, code: number | null = null;
  try {
    if (job.relay_epoch !== configuration.epoch || !MOBILE.test(job.receiver_number) || !APPROVED_SENDERS.has(job.sender_number)) throw new Error("PREFLIGHT_REJECTED");
    validateMessage(job.message,job.msg_type,job.title || "");
    const images = await loadImages(admin,job.image_paths,job.law_firm_id);
    // Do this after image downloads, immediately before the only provider attempt.
    if (!await stillAllowed(admin,job)) throw new Error("GATE_CHANGED_OR_DISABLED");
    outcome = "unknown"; errorCode = "RELAY_OUTCOME_UNKNOWN";
    const result = await relay(configuration,"send",{
      dispatchId:job.attempt_id,approvalEpoch:job.relay_epoch,sender:job.sender_number,receiver:job.receiver_number,
      message:job.message,msgType:job.msg_type,title:job.title || "",images,provider:configuration.provider,
    });
    if (result.testMode !== false || result.dispatchId !== job.attempt_id) throw new Error("RELAY_OUTCOME_UNKNOWN");
    code = providerCode(result.providerCode);
    if (result.state === "accepted" && providerId(result.messageId) && code !== null && code > 0) {
      outcome = "accepted"; messageId = result.messageId; errorCode = null;
    } else if (result.state === "rejected" && code !== null && code <= 0) {
      outcome = "failed"; errorCode = "PROVIDER_REJECTED";
    }
  } catch { /* Before relay: safely failed. After relay: ambiguous, never retried. */ }
  const {error} = await admin.rpc("sms_delivery_finish",{
    p_job_id:job.id,p_attempt_id:job.attempt_id,p_outcome:outcome,
    p_provider_message_id:messageId,p_provider_code:code,p_error_code:errorCode,
  });
  if (error) throw new Error("FINISH_NOT_CONFIRMED");
  return outcome;
}

async function checkReceipt(admin: SmsAdmin, configuration: Configuration) {
  const cutoff = new Date(Date.now()-60_000).toISOString();
  const {data,error} = await admin.from("sms_delivery_jobs").select("*").eq("relay_epoch",configuration.epoch)
    .eq("status","accepted").eq("delivery_state","unconfirmed")
    .or(`delivery_checked_at.is.null,delivery_checked_at.lt.${cutoff}`).order("created_at").limit(1);
  if (error) throw new Error("RECEIPT_LOOKUP_FAILED");
  const job = (data as DeliveryJob[] | null)?.[0];
  if (!job?.attempt_id || !job.provider_message_id) return "none";
  let state = "unknown", code: number | null = null;
  try {
    if (Date.now()-Date.parse(job.completed_at || job.created_at) < 24*60*60*1000) {
      const result = await relay(configuration,"results",{dispatchId:job.attempt_id,approvalEpoch:job.relay_epoch,provider:configuration.provider});
      if (result.testMode !== false || result.dispatchId !== job.attempt_id || result.messageId !== job.provider_message_id) throw new Error("INVALID_RECEIPT");
      code = providerCode(result.providerCode);
      if (["delivered","failed","pending"].includes(String(result.state)) && code !== null && code > 0) state = String(result.state);
    }
  } catch { /* Preserve uncertainty without repeating a send. */ }
  const {error: updateError} = await admin.rpc("sms_delivery_reconcile",{p_job_id:job.id,p_attempt_id:job.attempt_id,p_delivery_state:state,p_provider_code:code});
  if (updateError) throw new Error("RECEIPT_SAVE_FAILED");
  return state;
}

/** Only sms_delivery_jobs is a work source. Legacy sms_outbox is never scanned. */
export async function runSmsWorker(admin: SmsAdmin) {
  const startedAt = Date.now();
  const configuration = readLiveConfiguration();
  const {data,error} = await admin.rpc("sms_delivery_claim",{p_relay_epoch:configuration.epoch,p_limit:1,p_lease_seconds:120});
  if (error) throw new Error("CLAIM_FAILED");
  const outcomes: string[] = [];
  for (const job of (data || []) as DeliveryJob[]) outcomes.push(await processJob(admin,configuration,job));
  const receipt = Date.now()-startedAt<30_000 ? await checkReceipt(admin,configuration) : "deferred";
  return {claimed:outcomes.length,outcomes,receipt};
}
