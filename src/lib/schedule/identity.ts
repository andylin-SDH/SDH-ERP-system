/** 班表上的名字對到登入帳號。只認這五位，其他人可以看、不能改。 */

const ALIASES: Record<string, string[]> = {
  林安迪: ["林安迪", "andy", "andylin"],
  五吉郎: ["五吉郎"],
  克萊: ["克萊", "claire"],
  維尼: ["維尼", "winnie", "winnieliang"],
  IVY: ["ivy", "ivylan", "ivyhsu"],
};

export function schedulePersonOf(user: { name?: string | null; email?: string | null } | null): string | null {
  if (!user) return null;
  const name = String(user.name ?? "").trim().toLowerCase();
  const email = String(user.email ?? "").trim().toLowerCase();
  const local = email.split("@")[0] ?? "";
  for (const [person, aliases] of Object.entries(ALIASES)) {
    if (aliases.some((alias) => alias === name || alias === local)) return person;
  }
  return null;
}
