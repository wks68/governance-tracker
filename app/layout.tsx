import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { ROLES } from "@/lib/governance";
import "./globals.css";

export const metadata: Metadata = {
  title: "DMS Governance Tracker",
  description: "內部治理流程管理 MVP"
};

async function getCurrentRole() {
  const cookieStore = await cookies();
  const role = cookieStore.get("dmsRole")?.value ?? "Admin";
  return ROLES.includes(role as (typeof ROLES)[number]) ? role : "Admin";
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant-TW">
      <body>
        <AppShell currentRole={await getCurrentRole()}>{children}</AppShell>
      </body>
    </html>
  );
}
