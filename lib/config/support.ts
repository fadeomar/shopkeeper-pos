/**
 * Support / admin contact configuration.
 *
 * Deliberately NOT sourced from `settings.businessPhone` — that field is the
 * shop's own number printed on receipts. Support is the operator that deploys
 * and approves users.
 *
 * Phase 1: a single operator. The operator's WhatsApp + phone ship as built-in
 * defaults below so the contact actions always work in production; the public
 * env vars (if set) override them per-deployment. Everything resolves to plain
 * href links (wa.me / tel: / mailto:) so the contact actions work fully offline
 * and need no JS.
 *
 * Override in .env.local (optional):
 *   NEXT_PUBLIC_SUPPORT_WHATSAPP=970590000000   (digits only, country code, no +)
 *   NEXT_PUBLIC_SUPPORT_PHONE=+970590000000
 *   NEXT_PUBLIC_SUPPORT_EMAIL=support@example.com
 *
 * Any value (env or default) left blank simply hides that action — the UI
 * degrades gracefully.
 */

// Built-in operator contact. wa.me needs the full international number with no
// '+' or leading zero (972 = Israel, then 56-744-1842 → 567441842); the phone
// link uses the local dialable form.
const DEFAULT_SUPPORT_WHATSAPP = "972567441842";
const DEFAULT_SUPPORT_PHONE = "0567441842";

export interface SupportContact {
  whatsapp: string | null;
  phone: string | null;
  email: string | null;
}

function digitsOnly(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[^\d]/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

function trimmed(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

export const supportContact: SupportContact = {
  whatsapp: digitsOnly(process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP) ?? DEFAULT_SUPPORT_WHATSAPP,
  phone: trimmed(process.env.NEXT_PUBLIC_SUPPORT_PHONE) ?? DEFAULT_SUPPORT_PHONE,
  email: trimmed(process.env.NEXT_PUBLIC_SUPPORT_EMAIL),
};

export function hasAnySupportContact(c: SupportContact = supportContact): boolean {
  return Boolean(c.whatsapp || c.phone || c.email);
}

export function buildWhatsappUrl(
  message?: string,
  c: SupportContact = supportContact,
): string | null {
  if (!c.whatsapp) return null;
  const base = `https://wa.me/${c.whatsapp}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

export function buildTelUrl(c: SupportContact = supportContact): string | null {
  if (!c.phone) return null;
  return `tel:${c.phone.replace(/\s+/g, "")}`;
}

export function buildMailtoUrl(
  opts?: { subject?: string; body?: string },
  c: SupportContact = supportContact,
): string | null {
  if (!c.email) return null;
  const params = new URLSearchParams();
  if (opts?.subject) params.set("subject", opts.subject);
  if (opts?.body) params.set("body", opts.body);
  const qs = params.toString();
  return qs ? `mailto:${c.email}?${qs}` : `mailto:${c.email}`;
}
