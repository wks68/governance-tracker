import { redirect } from "next/navigation";

// 治理儀表板收斂：/governance 為唯一正式治理儀表板頁面，本路由僅保留 redirect
// 以免既有書籤／外部連結失效，不再提供獨立可操作的畫面。
export default function DashboardRedirectPage() {
  redirect("/governance");
}
