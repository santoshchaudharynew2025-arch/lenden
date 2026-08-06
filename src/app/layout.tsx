import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "लेनदेन - हिसाब प्रबंधन ऐप",
  description: "अपने सभी लेनदेन, लोन और ब्याज का हिसाब रखें",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon.png", type: "image/png", sizes: "500x500" },
    ],
    shortcut: "/favicon.ico",
    apple: "/logo.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hi">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" href="/favicon.png" type="image/png" sizes="500x500" />
        <link rel="apple-touch-icon" href="/logo.png" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  )
}
