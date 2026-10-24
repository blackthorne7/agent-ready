import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "700"],
});

export const metadata: Metadata = {
  title: "Agent Ready: can AI read your website?",
  description:
    "Your next customer is asking AI where to go. Get a free score showing whether AI assistants can find your business, understand what you sell, and book or order for your customers, plus a fix link you paste into your website builder.",
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
      <body className={`${inter.variable} ${spaceGrotesk.variable} antialiased`}>{children}</body>
    </html>
  );
}
