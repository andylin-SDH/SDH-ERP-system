/**
 * 開發階段追蹤用 Log，前綴 [SDH:模組名] 方便在 terminal 篩選
 */
const PREFIX = "[SDH]";

export function log(module: string, message: string, data?: Record<string, unknown>) {
  const payload = data ? ` ${JSON.stringify(data)}` : "";
  console.log(`${PREFIX}[${module}] ${message}${payload}`);
}
