export function canReviewInvoice(role: string | null | undefined): boolean {
  const value = String(role ?? "").trim();
  return value === "董事長" || value === "會計";
}
