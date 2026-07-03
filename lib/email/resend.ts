// Transactional email via the Resend REST API (https://resend.com/docs). Called
// with fetch - no SDK dependency. Used for the user-onboarding invite flow.

import type { Role } from "../auth/types";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const ACCENT = "#FFE600";
const INK = "#1A1A24";

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
  /** True when the API key / from address isn't configured (so callers can fall
   *  back to sharing the invite link manually). */
  notConfigured?: boolean;
}

const roleLabel = (r: Role) => (r === "administrator" ? "Administrator" : "Consumer");

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface InviteEmailInput {
  to: string;
  name?: string;
  role: Role;
  inviteUrl: string;
  invitedBy?: string;
}

function inviteHtml({ name, role, inviteUrl, invitedBy }: InviteEmailInput): string {
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi,";
  const inviter = invitedBy ? `${escapeHtml(invitedBy)} invited you` : "You have been invited";
  const url = escapeHtml(inviteUrl);
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f2f2f5;font-family:Arial,Helvetica,sans-serif;color:#1a1a24;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e4e4ea;">
        <tr><td style="padding:24px 28px 8px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:30px;height:30px;background:${ACCENT};text-align:center;vertical-align:middle;font-weight:bold;color:${INK};font-size:15px;">CE</td>
            <td style="padding-left:10px;font-size:15px;font-weight:bold;color:#1a1a24;">Client Tool Emulator</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:16px 28px 4px;font-size:14px;line-height:1.5;">
          <p style="margin:0 0 14px;">${greeting}</p>
          <p style="margin:0 0 14px;">${inviter} to the <strong>Client Tool Emulator</strong> as a <strong>${roleLabel(role)}</strong>. Set a password to activate your account and sign in.</p>
        </td></tr>
        <tr><td style="padding:8px 28px 20px;">
          <a href="${url}" style="display:inline-block;background:${ACCENT};color:${INK};text-decoration:none;font-weight:bold;font-size:14px;padding:11px 22px;">Set your password</a>
        </td></tr>
        <tr><td style="padding:0 28px 24px;font-size:12px;line-height:1.5;color:#6b6b78;">
          <p style="margin:0 0 8px;">This invitation link expires in 72 hours. If the button doesn't work, paste this URL into your browser:</p>
          <p style="margin:0;word-break:break-all;"><a href="${url}" style="color:#8a7400;">${url}</a></p>
          <p style="margin:14px 0 0;">If you weren't expecting this, you can safely ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function inviteText({ name, role, inviteUrl, invitedBy }: InviteEmailInput): string {
  const greeting = name ? `Hi ${name},` : "Hi,";
  const inviter = invitedBy ? `${invitedBy} invited you` : "You have been invited";
  return `${greeting}

${inviter} to the Client Tool Emulator as a ${roleLabel(role)}. Set a password to activate your account:

${inviteUrl}

This link expires in 72 hours. If you weren't expecting this, you can ignore this email.`;
}

export async function sendInviteEmail(input: InviteEmailInput): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { ok: false, notConfigured: true, error: "email is not configured (RESEND_API_KEY / EMAIL_FROM)" };

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: "You're invited to the Client Tool Emulator",
        html: inviteHtml(input),
        text: inviteText(input),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.message || body?.error || `Resend HTTP ${res.status}` };
    return { ok: true, id: body?.id };
  } catch (e: any) {
    return { ok: false, error: e?.message || "email send failed" };
  }
}
