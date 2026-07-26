import type { Metadata } from "next";
import { Fraunces, Spline_Sans, Spline_Sans_Mono } from "next/font/google";
import Link from "next/link";
import "katex/dist/katex.min.css";
import "./globals.css";
import { NavLinks } from "@/components/NavLinks";
import { Logo } from "@/components/Logo";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
});

const splineSans = Spline_Sans({
  variable: "--font-spline",
  subsets: ["latin"],
});

const splineMono = Spline_Sans_Mono({
  variable: "--font-spline-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI.Next — AI Tutor PoC",
  description:
    "Curriculum-grounded adaptive tutor built on an agent-native data spine.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${splineSans.variable} ${splineMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="relative z-20 border-b border-line bg-card/70 backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-6">
            <Link href="/" className="flex items-center gap-2.5">
              <Logo className="h-8 w-8 shrink-0" />
              <span className="font-display text-lg font-semibold tracking-tight text-ink">
                AI<span className="text-accent">.</span>Next
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                Tutor PoC · Data Spine
              </span>
            </Link>
            <NavLinks />
          </div>
        </header>
        <div className="relative z-10 flex-1">{children}</div>
        <footer className="relative z-10 border-t border-line-soft">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-4 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
            <span>AI.Next · Agent-Native Data Spine — investor preview</span>
            {/* course-level, not lesson-level: any selected lesson/unit shows
                its own module label on the surface itself */}
            <span>Prep-3 Mathematics · MOETE 2025–2026</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
