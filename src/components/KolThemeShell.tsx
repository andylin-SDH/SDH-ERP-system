"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type KolThemeMode = "light" | "dark";

type KolThemeContextValue = {
  theme: KolThemeMode;
  isDark: boolean;
  setTheme: (mode: KolThemeMode) => void;
  toggleTheme: () => void;
};

const STORAGE_KEY = "kol-theme-preview";

const KolThemeContext = createContext<KolThemeContextValue | null>(null);

export function useKolTheme(): KolThemeContextValue {
  const ctx = useContext(KolThemeContext);
  if (!ctx) {
    return {
      theme: "light",
      isDark: false,
      setTheme: () => {},
      toggleTheme: () => {},
    };
  }
  return ctx;
}

/**
 * KOL 入口主題殼層（本機預覽用）。
 * 黑底建議：暖近黑底 + 淺字 + 琥珀操作色；摘要用數字上色，避免整塊高飽和色塊。
 */
export function KolThemeShell({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<KolThemeMode>("dark");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved === "light" || saved === "dark") setThemeState(saved);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const setTheme = useCallback((mode: KolThemeMode) => {
    setThemeState(mode);
    try {
      sessionStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  const value = useMemo(
    () => ({ theme, isDark: theme === "dark", setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme]
  );

  const isDark = theme === "dark";

  return (
    <KolThemeContext.Provider value={value}>
      <div
        className={
          isDark
            ? "min-h-screen bg-[#0b0b0c] text-stone-200 antialiased [background-image:radial-gradient(900px_420px_at_12%_-10%,rgba(217,119,6,0.12),transparent_55%),radial-gradient(700px_360px_at_90%_0%,rgba(244,63,94,0.08),transparent_50%)]"
            : "min-h-screen bg-gradient-to-b from-[#fffbf5] via-[#faf8f5] to-[#f0ebe3] text-stone-800"
        }
        data-kol-theme={theme}
        style={ready ? undefined : { visibility: "hidden" }}
      >
        {children}
        <div className="fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-1.5">
          <p
            className={`max-w-[11rem] text-right text-[10px] leading-snug ${
              isDark ? "text-stone-500" : "text-stone-400"
            }`}
          >
            本機預覽 · 不影響正式預設
          </p>
          <button
            type="button"
            onClick={toggleTheme}
            className={
              isDark
                ? "rounded-xl border border-white/15 bg-white/10 px-3.5 py-2 text-xs font-semibold text-stone-100 shadow-lg backdrop-blur-md transition hover:bg-white/15"
                : "rounded-xl border border-stone-300 bg-white px-3.5 py-2 text-xs font-semibold text-stone-700 shadow-md transition hover:bg-stone-50"
            }
          >
            {isDark ? "切回淺色" : "預覽黑底"}
          </button>
        </div>
      </div>
    </KolThemeContext.Provider>
  );
}
