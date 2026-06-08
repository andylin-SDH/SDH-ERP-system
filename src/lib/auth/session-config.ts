/** Session cookie 有效期限（秒） */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export const SESSION_EMAIL_COOKIE = "erp_email";
export const SESSION_EXPIRES_COOKIE = "erp_session_exp";

/** 到期前幾秒開始提醒 */
export const SESSION_WARN_BEFORE_SECONDS = 10 * 60;

/** 前端輪詢間隔（毫秒） */
export const SESSION_POLL_INTERVAL_MS = 30_000;
