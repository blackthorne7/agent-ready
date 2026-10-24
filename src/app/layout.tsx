import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent Ready: is your website ready for AI agents?",
  description:
    "Audit any website for AI agent readiness. See whether agents like Claude can access, understand and act on your site (hours, menus, ordering), with a score and copy-paste fixes. Also available as an MCP server.",
  openGraph: {
    title: "Agent Ready",
    description: "Lighthouse for AI agents. Score your site and get fixes.",
    type: "website",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Agent Ready",
  applicationCategory: "DeveloperApplication",
  description: "Audits websites for AI agent readiness and exposes the audit as an MCP server.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  potentialAction: {
    "@type": "SearchAction",
    target: "/report?url={url}",
    "query-input": "required name=url",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="mcp" href="/api/mcp" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
