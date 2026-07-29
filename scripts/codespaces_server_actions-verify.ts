// Codespaces Preview Server Actions targeted verify：純靜態／設定檢查，不連線、建立或重建任何 DB。

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.resolve(__dirname, "..");
const requireFromRoot = createRequire(path.join(ROOT, "package.json"));
let passCount = 0;

function check(name: string, condition: boolean) {
  assert.ok(condition, name);
  passCount += 1;
  console.log(`  PASS  ${name}`);
}

const originalEnv = {
  NEXT_SERVER_ACTIONS_ALLOWED_ORIGIN: process.env.NEXT_SERVER_ACTIONS_ALLOWED_ORIGIN,
  NEXT_SERVER_ACTIONS_PREVIEW_PORT: process.env.NEXT_SERVER_ACTIONS_PREVIEW_PORT,
  CODESPACE_NAME: process.env.CODESPACE_NAME,
  GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:
    process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN,
};

try {
  process.env.NEXT_SERVER_ACTIONS_ALLOWED_ORIGIN =
    "explicit-preview-3100.app.github.dev";
  process.env.NEXT_SERVER_ACTIONS_PREVIEW_PORT = "3100";
  process.env.CODESPACE_NAME = "current-codespace";
  process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN = "app.github.dev";

  const configPath = path.join(ROOT, "next.config.js");
  delete requireFromRoot.cache[requireFromRoot.resolve(configPath)];
  const config = requireFromRoot(configPath);
  const allowedOrigins = config.experimental?.serverActions?.allowedOrigins;

  check("[1] next.config 啟用 experimental.serverActions.allowedOrigins", Array.isArray(allowedOrigins));
  check("[2] localhost:3100 與 127.0.0.1:3100 仍可使用", allowedOrigins.includes("localhost:3100") && allowedOrigins.includes("127.0.0.1:3100"));
  check("[3] 可由 Codespaces 環境變數組出目前 exact forwarded hostname", allowedOrigins.includes("current-codespace-3100.app.github.dev"));
  check("[4] 可用 NEXT_SERVER_ACTIONS_ALLOWED_ORIGIN 注入 exact hostname", allowedOrigins.includes("explicit-preview-3100.app.github.dev"));
  check("[5] allowedOrigins 不含 wildcard、protocol 或 path", allowedOrigins.every((origin: string) => !origin.includes("*") && !origin.includes("://") && !origin.includes("/")));

  const configSource = fs.readFileSync(configPath, "utf8");
  check("[6] next.config 不再無條件信任 *.app.github.dev 或 *", !configSource.includes('"*.app.github.dev"') && !configSource.includes('["*"]'));

  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const previewCommand = String(packageJson.scripts?.["dev:hotfix-ui-preview"] ?? "");
  check("[7] Preview 啟動固定宣告 Server Actions Preview port=3100", previewCommand.includes('NEXT_SERVER_ACTIONS_PREVIEW_PORT="3100"'));
  check("[8] Preview 啟動只連既有 Preview DB，不含 rm／migrate／seed／重建指令", previewCommand.includes('file:./hotfix-ui-preview.db') && !/\brm\b|migrate|seed|hotfix-ui:preview/.test(previewCommand));

  const pageSource = fs.readFileSync(path.join(ROOT, "src/app/login/page.tsx"), "utf8");
  const formSource = fs.readFileSync(path.join(ROOT, "src/app/login/LoginUserForm.tsx"), "utf8");
  check("[9] Login page render 階段不直接呼叫或綁定 loginAsUserAction", !pageSource.includes("loginAsUserAction"));
  check("[10] Login action 只由使用者 submit handler 觸發", formSource.includes("onSubmit={handleSubmit}") && formSource.includes("await loginAsUserAction(formData)"));
  check("[11] Server Action transport failure 顯示指定友善中文訊息", formSource.includes("登入請求無法完成，請重新整理頁面後再試一次。"));

  console.log(`\n=== 結果：PASS ${passCount} / FAIL 0 ===`);
} finally {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
