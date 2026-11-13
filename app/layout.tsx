import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import '@xyflow/react/dist/base.css';
import "./globals.css";
import { ReactNode } from "react";
import AppShell from "@/components/layout/app_shell";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

const description = "Build, test and compare AI workflows without code. Chain prompts across OpenAI, Claude and Gemini, add branches, loops and tools, and see the cost of every step."

export const metadata: Metadata = {
  metadataBase: new URL("https://llmflow.netlify.app"),
  title: "LLM Flow",
  description,
  keywords: ["AI", "LLM", "flow", "workflow", "prompt", "OpenAI", "Claude", "Gemini", "no-code"],
  authors: [{ name: "Thanura Nadun Ranasinghe" }],
  openGraph: { title: "LLM Flow", description, type: "website", url: "/" },
  twitter: { card: "summary_large_image", title: "LLM Flow", description },
  icons: { icon: "/favicon.ico" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#020817" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
