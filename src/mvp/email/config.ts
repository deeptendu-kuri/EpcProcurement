import { z } from "zod";

export interface DemoEmailInfo {
  enabled: boolean;
  ready: boolean;
  recipient: string | null;
  error: string | null;
}

const email = z.email();
export const DEMO_CONTACT_EMAIL = "demo-contact@example.com";

export function demoEmailEnabled(): boolean {
  return process.env.DEMO_EMAIL_ENABLED?.trim() === "1";
}

/** Public configuration for signed-in users. Never return the provider API key. */
export function demoEmailInfo(): DemoEmailInfo {
  const enabled = demoEmailEnabled();
  const recipient = process.env.DEMO_RECIPIENT_EMAIL?.trim() ?? "";
  const from = process.env.DEMO_EMAIL_FROM?.trim() || "Demo <onboarding@resend.dev>";
  const senderAddress = from.match(/<([^<>]+)>$/)?.[1] ?? from;
  let error: string | null = null;
  if (!enabled) error = "Demo sending is disabled on the server.";
  else if (!email.safeParse(recipient).success) error = "Set DEMO_RECIPIENT_EMAIL to your one test inbox.";
  else if (!process.env.RESEND_API_KEY?.trim()) error = "Set RESEND_API_KEY to enable delivery to the test inbox.";
  else if (/[\r\n]/.test(from) || !email.safeParse(senderAddress).success) error = "DEMO_EMAIL_FROM must be a valid sender address.";
  return { enabled, ready: !error, recipient: email.safeParse(recipient).success ? recipient : null, error };
}

export function demoEmailSettings() {
  const info = demoEmailInfo();
  const from = process.env.DEMO_EMAIL_FROM?.trim() || "Demo <onboarding@resend.dev>";
  const address = from.match(/<([^<>]+)>$/)?.[1] ?? from;
  if (!info.ready || !info.recipient) throw new Error(info.error ?? "Demo sending is not configured.");
  if (/[\r\n]/.test(from) || !email.safeParse(address).success) throw new Error("DEMO_EMAIL_FROM must be a valid sender address.");
  return { recipient: info.recipient, from, apiKey: process.env.RESEND_API_KEY!.trim() };
}
