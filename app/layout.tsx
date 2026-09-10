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
  metadataBase: new URL("https://aps-loan-crm-preeti.cheery-loom-2594.chatgpt.site"),
  title: "APS Loan CRM",
  description:
    "A private loan sales and processing CRM for leads, assignments, documents, notifications, and reports.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "APS Loan CRM",
    description:
      "A private loan team CRM for pipeline, documents, notifications, and reports.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "APS Loan CRM dashboard preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "APS Loan CRM",
    description:
      "A private loan team CRM for pipeline, documents, notifications, and reports.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
