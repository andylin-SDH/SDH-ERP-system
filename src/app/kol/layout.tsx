import type { ReactNode } from "react";
import { KolThemeShell } from "@/components/KolThemeShell";

export default function KolLayout({ children }: { children: ReactNode }) {
  return <KolThemeShell>{children}</KolThemeShell>;
}
