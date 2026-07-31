import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: {
    default: "DMS 工作管理平台",
    template: "%s｜DMS WorkHub",
  },
  description: "DMS WorkHub 工作管理與治理協作平台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body className="min-h-screen bg-background text-text-primary antialiased">
        <Nav>{children}</Nav>
      </body>
    </html>
  );
}
