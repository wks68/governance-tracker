// Hotfix 九階段 UI：附件（選填）位元組讀取端點（預覽／下載共用）。
//
// 一律要求已登入且具備 issue.view 能力才能讀取（比照 workflow-execution 既有唯讀查詢
// 授權門檻），不是公開靜態檔案——不得放在 public/ 目錄下用路徑直接猜測存取。

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasExecutionCapability } from "@/lib/workflowExecutionService";
import { prisma } from "@/lib/prisma";
import { readAttachmentFile } from "@/lib/hotfix-ui/attachmentStorage";
import { ATTACHMENT_URL_PREFIX } from "@/lib/hotfix-ui/attachmentStorage";
import { repairDisplayFileName, asciiFallbackFileName } from "@/lib/hotfix-ui/fileNameDisplay";

export async function GET(request: NextRequest, { params }: { params: { storedFileName: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "請先登入" }, { status: 401 });

  const canView = await hasExecutionCapability(user.id, "issue.view");
  if (!canView) return NextResponse.json({ message: "沒有權限" }, { status: 403 });

  const url = `${ATTACHMENT_URL_PREFIX}${params.storedFileName}`;
  const evidence = await prisma.evidence.findFirst({ where: { url } });
  if (!evidence) return NextResponse.json({ message: "找不到此附件" }, { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readAttachmentFile(params.storedFileName);
  } catch {
    return NextResponse.json({ message: "附件檔案已遺失" }, { status: 404 });
  }

  const download = request.nextUrl.searchParams.get("download") === "1";
  const disposition = download ? "attachment" : "inline";
  const displayName = repairDisplayFileName(evidence.title || "attachment");
  const asciiName = asciiFallbackFileName(displayName).replace(/"/g, "'");
  const utf8Name = encodeURIComponent(displayName);

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": evidence.type || "application/octet-stream",
      "Content-Disposition": `${disposition}; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
      "Cache-Control": "private, no-store",
    },
  });
}
