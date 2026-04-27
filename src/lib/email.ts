/**
 * 郵件發送（Resend）
 * 需在 .env.local 設定 RESEND_API_KEY，並驗證寄件者網域
 */

import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "SDH ERP <onboarding@resend.dev>";

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendTaskAssignedEmail(params: {
  to: string;
  taskName: string;
  projectId: string;
  projectName?: string;
  creator?: string;
  note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!resend) {
    console.warn("email: RESEND_API_KEY 未設定，跳過寄信");
    return { ok: false, error: "RESEND_API_KEY 未設定" };
  }
  try {
    const { to, taskName, projectId, projectName, creator, note } = params;
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    const loginUrl = `${appUrl}/`;
    const taskTitle = taskName || "未命名任務";
    const trimmedCreator = String(creator ?? "").trim();
    const trimmedNote = String(note ?? "").trim();
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject: `【SDH ERP】新任務指派：${taskTitle}`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f1f5f9;line-height:1.6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:24px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.05);overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);padding:24px 32px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">SDH 盛德好 ERP</h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:14px;">任務指派通知</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 20px;color:#334155;font-size:16px;">您好，</p>
              <p style="margin:0 0 24px;color:#475569;font-size:15px;">您已被指派一項新任務，請登入系統查看並處理。</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0;color:#64748b;font-size:13px;width:90px;">任務</td>
                        <td style="padding:8px 0;color:#1e293b;font-size:15px;font-weight:600;">${escapeHtml(taskTitle)}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;color:#64748b;font-size:13px;">專案ID</td>
                        <td style="padding:8px 0;color:#475569;font-size:14px;font-family:monospace;">${escapeHtml(projectId || "—")}</td>
                      </tr>
                      ${projectName ? `
                      <tr>
                        <td style="padding:8px 0;color:#64748b;font-size:13px;">專案名稱</td>
                        <td style="padding:8px 0;color:#475569;font-size:14px;">${escapeHtml(projectName)}</td>
                      </tr>
                      ` : ""}
                      ${trimmedCreator ? `
                      <tr>
                        <td style="padding:8px 0;color:#64748b;font-size:13px;">建立者</td>
                        <td style="padding:8px 0;color:#475569;font-size:14px;">${escapeHtml(trimmedCreator)}</td>
                      </tr>
                      ` : ""}
                      ${trimmedNote ? `
                      <tr>
                        <td style="padding:8px 0;color:#64748b;font-size:13px;vertical-align:top;">備註</td>
                        <td style="padding:8px 0;color:#475569;font-size:14px;white-space:pre-wrap;">${escapeHtml(trimmedNote)}</td>
                      </tr>
                      ` : ""}
                    </table>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${loginUrl}" style="display:inline-block;background:#f59e0b;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:8px;box-shadow:0 2px 4px rgba(245,158,11,0.3);">登入系統查看</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">此為系統自動寄送，請勿直接回覆此信件。</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `,
    });
    if (error) {
      console.error("email: sendTaskAssignedEmail 失敗", { to, error });
      return { ok: false, error: String(error) };
    }
    return { ok: true };
  } catch (err) {
    console.error("email: sendTaskAssignedEmail 異常", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 任務即將到期／已逾期提醒（與指派通知分開） */
export async function sendTaskDueSoonEmail(params: {
  to: string;
  taskName: string;
  projectId: string;
  projectName?: string;
  creator?: string;
  note?: string;
  dueDate: string;
  /** 已逾期為 true，否則為即將到期（含當天起算 N 天內） */
  isOverdue: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  if (!resend) {
    console.warn("email: RESEND_API_KEY 未設定，跳過寄信");
    return { ok: false, error: "RESEND_API_KEY 未設定" };
  }
  try {
    const { to, taskName, projectId, projectName, creator, note, dueDate, isOverdue } = params;
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    const loginUrl = `${appUrl}/`;
    const taskTitle = taskName || "未命名任務";
    const trimmedCreator = String(creator ?? "").trim();
    const trimmedNote = String(note ?? "").trim();
    const subject = isOverdue
      ? `【SDH ERP】任務已逾期：${taskTitle}`
      : `【SDH ERP】任務即將到期：${taskTitle}`;
    const lead = isOverdue
      ? "以下任務已超過預定完成日，請儘快處理。"
      : "以下任務即將到期，請留意時程。";
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#f1f5f9;line-height:1.6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:24px 0;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.05);overflow:hidden;">
        <tr>
          <td style="background:linear-gradient(135deg,#b45309 0%,#d97706 100%);padding:24px 32px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">SDH 盛德好 ERP</h1>
            <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:14px;">${isOverdue ? "逾期提醒" : "即將到期提醒"}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;color:#334155;font-size:16px;">您好，</p>
            <p style="margin:0 0 24px;color:#475569;font-size:15px;">${lead}</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:24px;">
              <tr><td style="padding:20px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:90px;">任務</td>
                      <td style="padding:8px 0;color:#1e293b;font-size:15px;font-weight:600;">${escapeHtml(taskTitle)}</td></tr>
                  <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">到期日</td>
                      <td style="padding:8px 0;color:#b45309;font-size:15px;font-weight:600;">${escapeHtml(dueDate)}</td></tr>
                  <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">專案ID</td>
                      <td style="padding:8px 0;color:#475569;font-size:14px;font-family:monospace;">${escapeHtml(projectId || "—")}</td></tr>
                  ${projectName ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;">專案名稱</td>
                      <td style="padding:8px 0;color:#475569;font-size:14px;">${escapeHtml(projectName)}</td></tr>` : ""}
                  ${trimmedCreator ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;">建立者</td>
                      <td style="padding:8px 0;color:#475569;font-size:14px;">${escapeHtml(trimmedCreator)}</td></tr>` : ""}
                  ${trimmedNote ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;vertical-align:top;">備註</td>
                      <td style="padding:8px 0;color:#475569;font-size:14px;white-space:pre-wrap;">${escapeHtml(trimmedNote)}</td></tr>` : ""}
                </table>
              </td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
              <a href="${loginUrl}" style="display:inline-block;background:#d97706;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:8px;">登入系統查看</a>
            </td></tr></table>
          </td>
        </tr>
        <tr><td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#94a3b8;font-size:12px;">此為系統自動寄送，請勿直接回覆此信件。</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    });
    if (error) {
      console.error("email: sendTaskDueSoonEmail 失敗", { to, error });
      return { ok: false, error: String(error) };
    }
    return { ok: true };
  } catch (err) {
    console.error("email: sendTaskDueSoonEmail 異常", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
