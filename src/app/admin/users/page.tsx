import { redirect } from "next/navigation";

// M1.5-C1-C：舊版使用者與角色管理頁已由 /admin/people（含完整角色、啟用／停用治理與
// Team 摘要）取代，僅保留這個重導，避免既有書籤或連結失效。
export default function AdminUsersRedirectPage() {
  redirect("/admin/people");
}
