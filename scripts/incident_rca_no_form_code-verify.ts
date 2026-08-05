// 靜態掃描：確保 Incident／RCA 相關的使用者可見畫面（頁面標題、麵包屑、卡片標題、頁籤、
// 按鈕、Toast、對話框、空狀態、Bell、我的待辦、歷程、欄位說明文字、驗證訊息、錯誤訊息、
// 清單欄位）不出現「F01」「F02」等紙本表單代號（任務規格第三節）。程式內部註解／測試檔名
// 允許保留 F01／F02 字樣（不會渲染到畫面），因此只掃描 .tsx／.ts 檔案中「非註解行」，且
// 允許本檔案自身與測試腳本檔名內出現字樣。
//   npx tsx scripts/incident_rca_no_form_code-verify.ts

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? `（${detail}）` : ""}`);
  }
}

const SCAN_ROOTS = ["src/app", "src/components"];
const FORM_CODE_PATTERN = /F0[12]/;

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

function main() {
  const files = SCAN_ROOTS.flatMap((root) =>
    execSync(`find ${root} -type f \\( -name "*.tsx" -o -name "*.ts" \\)`, { encoding: "utf8" })
      .split("\n")
      .filter(Boolean),
  );
  check("[0] 找到待掃描檔案", files.length > 0, `files=${files.length}`);

  const offenders: string[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const lines = content.split("\n");
    lines.forEach((line, index) => {
      if (isCommentLine(line)) return;
      if (!FORM_CODE_PATTERN.test(line)) return;
      offenders.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }

  check("[1] src/app、src/components 內非註解行不含 F01／F02", offenders.length === 0, offenders.join(" | "));

  console.log(`\n結果：PASS ${passed} / FAIL ${failed}`);
  if (failed > 0) {
    console.log("\n違規行：");
    offenders.forEach((o) => console.log(`  ${o}`));
    process.exitCode = 1;
  }
}

main();
