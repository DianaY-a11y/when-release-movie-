import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { FreshnessBadge } from "@/components/FreshnessBadge";
import { FilmProvider } from "@/lib/film-context";
import { CompareSelectionProvider } from "@/lib/compare-selection";
import { FilmSelector } from "@/components/FilmSelector";
import { FilmModal } from "@/components/FilmModal";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Slate Setter",
  description: "Release-week decision tool for theatrical distribution teams.",
};

const NAV = [
  { href: "/", label: "Landscape" },
  { href: "/compare", label: "Compare" },
  { href: "/film-profile", label: "Film Profile" },
  { href: "/backtest", label: "Backtest" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <FilmProvider>
        <CompareSelectionProvider>
          <header className="border-b border-[var(--color-line)] bg-[var(--color-paper)]">
            <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between gap-6">
              <div className="flex items-center gap-8">
                <Link
                  href="/"
                  className="font-semibold tracking-tight text-xl text-[var(--color-ink)]"
                >
                  Slate Setter
                </Link>
                <nav className="flex items-center gap-5 text-sm">
                  {NAV.map((n) => (
                    <Link
                      key={n.href}
                      href={n.href}
                      className="text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
                    >
                      {n.label}
                    </Link>
                  ))}
                </nav>
              </div>
              <div className="flex items-center gap-4">
                <FreshnessBadge />
                <FilmSelector />
              </div>
            </div>
          </header>
          <FilmModal />
          <main className="flex-1">{children}</main>
          <footer className="border-t border-[var(--color-line)] py-6 text-center text-xs text-[var(--color-muted)] uppercase tracking-widest">
            POC · release-week planning for distribution teams
          </footer>
        </CompareSelectionProvider>
        </FilmProvider>
      </body>
    </html>
  );
}
