// Transactional email through Resend (Vercel Marketplace integration, which sets RESEND_API_KEY).
// Until it's installed, email is skipped and people still get in-app and push notifications.
// RESEND_FROM must be on a domain verified in Resend; Resend's shared test sender
// (onboarding@resend.dev) only delivers to the Resend account's own address.

export type Email = { to: string; subject: string; text: string; html: string };

export async function sendEmail(email: Email) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM ?? "AgentBnB <onboarding@resend.dev>",
      to: [email.to],
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
  });
  if (!res.ok) {
    console.error("email failed", res.status, await res.text().catch(() => ""));
    return false;
  }
  return true;
}
