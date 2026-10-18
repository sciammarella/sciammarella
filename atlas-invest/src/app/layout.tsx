import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atlas Invest AI — Intelligent Investment Copilot",
  description: "Análise, recomendação e monitoramento de investimentos no Brasil e nos EUA, com risco explicável e evidências.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen font-sans">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
