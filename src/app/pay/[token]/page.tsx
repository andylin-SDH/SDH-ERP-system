"use client";

import Image from "next/image";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { PaymentFormPayload } from "@/lib/payment-collection/types";

async function safeResJson(r: Response): Promise<Record<string, unknown>> {
  const text = await r.text();
  if (!text.trim()) return {};
  try {
    return (JSON.parse(text) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

type FormState = {
  匯款單位: string;
  匯款日期: string;
  匯款金額: string;
  匯款末五碼: string;
  匯款帳號: string;
  聯絡人: string;
  聯絡Email: string;
  聯絡電話: string;
  備註: string;
};

function emptyForm(): FormState {
  return {
    匯款單位: "",
    匯款日期: "",
    匯款金額: "",
    匯款末五碼: "",
    匯款帳號: "",
    聯絡人: "",
    聯絡Email: "",
    聯絡電話: "",
    備註: "",
  };
}

export default function PaymentFormPage() {
  const params = useParams();
  const token = String(params?.token ?? "").trim();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<PaymentFormPayload | null>(null);
  const [draft, setDraft] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/public/payment-form?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    const data = (await safeResJson(res)) as { ok?: boolean; error?: string; form?: PaymentFormPayload };
    if (!res.ok || !data.ok || !data.form) {
      setError(data.error ?? "無法載入收款表單");
      setLoading(false);
      return;
    }
    setForm(data.form);
    setDraft((prev) => ({
      ...prev,
      匯款金額: data.form!.發票含稅合計 !== "—" ? data.form!.發票含稅合計.replace(/,/g, "") : "",
    }));
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/public/payment-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...draft }),
      });
      const data = (await safeResJson(res)) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setSubmitError(data.error ?? "提交失敗");
        return;
      }
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "提交失敗");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-8 sm:px-6">
      <header className="mb-8 flex items-center gap-4 border-b border-amber-200/80 pb-6">
        <Image src="/logo.png" alt="SDH" width={180} height={44} className="h-10 w-auto object-contain" />
        <div>
          <h1 className="text-lg font-bold tracking-tight text-stone-900">匯款通知表單</h1>
          <p className="text-xs text-stone-500">請填寫匯款資訊，以便我們對帳入帳</p>
        </div>
      </header>

      {loading && <p className="text-stone-500">載入中…</p>}
      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">{error}</div>
      )}

      {!loading && !error && form && submitted && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-8 text-center">
          <p className="text-lg font-bold text-emerald-900">已收到您的匯款資訊</p>
          <p className="mt-2 text-sm text-emerald-800">感謝您！我們將依此資訊進行對帳，確認後更新入帳狀態。</p>
        </div>
      )}

      {!loading && !error && form && !submitted && (
        <div className="space-y-6">
          <section className="rounded-xl border border-stone-200 bg-white/90 p-5 shadow-sm ring-1 ring-stone-100">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-stone-500">請款資訊</h2>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p>
                <span className="text-stone-500">專案：</span>
                <span className="font-semibold text-stone-900">{form.專案名稱}</span>
              </p>
              <p>
                <span className="text-stone-500">專案ID：</span>
                <span className="font-mono text-stone-800">{form.專案ID}</span>
              </p>
            </div>
            {form.invoices.length > 0 ? (
              <div className="mt-4 overflow-x-auto rounded-lg border border-stone-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-xs text-stone-600">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">發票號碼</th>
                      <th className="px-3 py-2 text-left font-semibold">發票日期</th>
                      <th className="px-3 py-2 text-left font-semibold">收款對象</th>
                      <th className="px-3 py-2 text-right font-semibold">含稅金額</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {form.invoices.map((inv, i) => (
                      <tr key={`${inv.發票號碼}-${i}`}>
                        <td className="whitespace-nowrap px-3 py-2 font-mono font-medium">{inv.發票號碼}</td>
                        <td className="whitespace-nowrap px-3 py-2">{inv.發票日期}</td>
                        <td className="px-3 py-2">{inv.收款對象}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-semibold">
                          {inv.發票金額含稅}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-amber-50/80">
                    <tr>
                      <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold text-stone-600">
                        含稅合計
                      </td>
                      <td className="px-3 py-2 text-right text-base font-bold tabular-nums text-amber-950">
                        {form.發票含稅合計}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="mt-3 text-sm text-stone-500">尚無發票明細</p>
            )}
          </section>

          <section className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-5">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-amber-900">請匯款至以下帳戶</h2>
            <ul className="space-y-1 text-sm font-medium text-stone-800">
              <li>戶名：{form.bank.戶名}</li>
              <li>
                {form.bank.銀行} {form.bank.分行}
              </li>
              <li className="font-mono text-base">帳號：{form.bank.帳號}</li>
            </ul>
          </section>

          <form onSubmit={(e) => void handleSubmit(e)} className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-stone-500">匯款資訊（請填寫）</h2>
            {submitError && (
              <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{submitError}</p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="mb-1 block text-xs font-semibold text-stone-600">匯款單位 *</span>
                <input
                  required
                  value={draft.匯款單位}
                  onChange={(e) => setDraft((d) => ({ ...d, 匯款單位: e.target.value }))}
                  className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm"
                  placeholder="公司或個人全名"
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-stone-600">匯款日期 *</span>
                <input
                  required
                  type="date"
                  value={draft.匯款日期}
                  onChange={(e) => setDraft((d) => ({ ...d, 匯款日期: e.target.value }))}
                  className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm"
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-stone-600">匯款金額 *</span>
                <input
                  required
                  inputMode="numeric"
                  value={draft.匯款金額}
                  onChange={(e) => setDraft((d) => ({ ...d, 匯款金額: e.target.value }))}
                  className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm tabular-nums"
                  placeholder="實際匯款金額"
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-stone-600">匯款末五碼 *</span>
                <input
                  required
                  inputMode="numeric"
                  maxLength={5}
                  pattern="\d{5}"
                  value={draft.匯款末五碼}
                  onChange={(e) => setDraft((d) => ({ ...d, 匯款末五碼: e.target.value.replace(/\D/g, "").slice(0, 5) }))}
                  className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm font-mono tracking-widest"
                  placeholder="12345"
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-stone-600">匯款帳號（選填）</span>
                <input
                  value={draft.匯款帳號}
                  onChange={(e) => setDraft((d) => ({ ...d, 匯款帳號: e.target.value }))}
                  className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm font-mono"
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-stone-600">聯絡人（選填）</span>
                <input
                  value={draft.聯絡人}
                  onChange={(e) => setDraft((d) => ({ ...d, 聯絡人: e.target.value }))}
                  className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm"
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-stone-600">聯絡 Email（選填）</span>
                <input
                  type="email"
                  value={draft.聯絡Email}
                  onChange={(e) => setDraft((d) => ({ ...d, 聯絡Email: e.target.value }))}
                  className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm"
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-semibold text-stone-600">聯絡電話（選填）</span>
                <input
                  value={draft.聯絡電話}
                  onChange={(e) => setDraft((d) => ({ ...d, 聯絡電話: e.target.value }))}
                  className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm"
                />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1 block text-xs font-semibold text-stone-600">備註（選填）</span>
                <textarea
                  rows={2}
                  value={draft.備註}
                  onChange={(e) => setDraft((d) => ({ ...d, 備註: e.target.value }))}
                  className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm"
                  placeholder="例如：分兩筆匯、備註專案名稱等"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-bold text-slate-900 shadow hover:bg-amber-400 disabled:opacity-60"
              >
                {submitting ? "提交中…" : "提交匯款資訊"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
