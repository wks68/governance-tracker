// C2-A 驗證腳本：Authentication Provider 抽象層。
//
// C2-A 本階段刻意不整合真實 LDAP／OIDC／SAML、不建立 Migration、不寫入任何
// User／UserRole／TeamMembership，因此本腳本完全不需要 DATABASE_URL、不 import
// Prisma、也不需要 next/headers 的 request context——這與既有的
// scripts/*-verify.ts（多半驗證會寫資料庫的服務層）性質不同。
//
// 本腳本涵蓋兩類檢查：
//   1. 純邏輯測試：Provider contract、config 驗證、SecretReference 形狀、
//      Registry、Factory、LocalProvider／FakeProvider、Identity Mapping、
//      錯誤 redaction。全部不觸碰檔案系統以外的任何外部狀態。
//   2. 原始碼層級的邊界檢查：模組不 import Prisma／UI／next/headers，
//      以及 M1／M2 紅線檔案（schema、migrations、auth.ts、permissions.ts、
//      Nav.tsx、package.json、package-lock.json）相對於 C2-A 起始基準
//      （m1-5-c1-c-complete）完全沒有變動。

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import {
  AuthProviderConfigurationError,
  AuthProviderUnavailableError,
  AuthProviderAuthenticationError,
  AuthProviderIdentityError,
  AuthProviderNotFoundError,
  isKnownAuthProviderError,
  containsSensitiveContent,
  toSafeProviderError,
  redactMessage,
} from "../src/lib/auth-providers/errors";
import { validateProviderConfig, toValidatedConfig, type AuthProviderConfig } from "../src/lib/auth-providers/config";
import {
  normalizeIdentity,
  validateNormalizedIdentity,
  mapExternalGroups,
  compareIdentityLinkCandidate,
} from "../src/lib/auth-providers/identity";
import { ProviderRegistry } from "../src/lib/auth-providers/registry";
import { createProviderFromConfig } from "../src/lib/auth-providers/factory";
import { createLocalProvider } from "../src/lib/auth-providers/local/localProvider";
import { createFakeProvider, createFakeIdentity, fakeConfig } from "../src/lib/auth-providers/testing/fakeProvider";

let passCount = 0;
let failCount = 0;
let skipCount = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    passCount++;
    console.log(`  PASS  ${name}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${name}`);
  }
}

async function checkAsync(name: string, fn: () => Promise<boolean>) {
  try {
    check(name, await fn());
  } catch (err) {
    failCount++;
    console.log(`  FAIL  ${name}（未預期例外：${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}）`);
  }
}

async function expectError(name: string, fn: () => unknown | Promise<unknown>, isExpected: (err: unknown) => boolean) {
  try {
    await fn();
    failCount++;
    console.log(`  FAIL  ${name}（未拋出任何錯誤）`);
  } catch (err) {
    if (isExpected(err)) {
      passCount++;
      console.log(`  PASS  ${name}`);
    } else {
      failCount++;
      console.log(`  FAIL  ${name}（拋出非預期錯誤：${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}）`);
    }
  }
}

function skip(name: string, reason: string) {
  skipCount++;
  console.log(`  SKIP  ${name}（${reason}）`);
}
void skip;

// ===========================================================================
// 1. Config 驗證與 SecretReference 形狀
// ===========================================================================
function runConfigTests() {
  console.log("\n=== C2-A 驗證：AuthProviderConfig／SecretReference（純邏輯） ===");

  const validConfig = {
    key: "local-1",
    kind: "LOCAL",
    displayName: "本機身分",
    enabled: true,
    settings: { greeting: "hi", retries: 3, allowList: ["a", "b"] },
    secrets: { bindPassword: { key: "bindPassword", referenceName: "local/bind", resolverId: "placeholder" } },
  };
  check("[C1] validateProviderConfig：合法設定通過驗證", validateProviderConfig(validConfig).valid === true);

  check(
    "[C2] validateProviderConfig：缺少 key 時拒絕",
    validateProviderConfig({ ...validConfig, key: "" }).valid === false,
  );
  check(
    "[C3] validateProviderConfig：kind 不在白名單內時拒絕",
    validateProviderConfig({ ...validConfig, kind: "KERBEROS" }).valid === false,
  );
  check(
    "[C4] validateProviderConfig：enabled 非布林值時拒絕",
    validateProviderConfig({ ...validConfig, enabled: "yes" }).valid === false,
  );
  check(
    "[C5] validateProviderConfig：settings 內出現物件型別值時拒絕（只允許字串／數字／布林／字串陣列）",
    validateProviderConfig({ ...validConfig, settings: { nested: { a: 1 } } }).valid === false,
  );
  check(
    "[C6] validateProviderConfig：secrets 內若直接放置字串（而非 SecretReference 物件）時拒絕",
    validateProviderConfig({ ...validConfig, secrets: { bindPassword: "s3cr3t-raw-value" } }).valid === false,
  );
  check(
    "[C7] validateProviderConfig：SecretReference 缺少 resolverId 時拒絕",
    validateProviderConfig({ ...validConfig, secrets: { bindPassword: { key: "bindPassword", referenceName: "local/bind" } } })
      .valid === false,
  );
  check("[C8] validateProviderConfig：省略 settings／secrets 時視為合法（等同空物件）", (() => {
    const { settings, secrets, ...rest } = validConfig;
    return validateProviderConfig(rest).valid === true;
  })());
  check("[C9] validateProviderConfig：輸入非物件（例如字串）時拒絕", validateProviderConfig("not-an-object").valid === false);

  const typed: AuthProviderConfig = toValidatedConfig(validConfig);
  check(
    "[C10] toValidatedConfig：SecretReference 運行時只含 key／referenceName／resolverId 三個欄位，不含任何 value",
    (() => {
      const ref = typed.secrets.bindPassword;
      const keys = Object.keys(ref).sort();
      return JSON.stringify(keys) === JSON.stringify(["key", "referenceName", "resolverId"]);
    })(),
  );
}

// ===========================================================================
// 2. Registry
// ===========================================================================
function runRegistryTests() {
  console.log("\n=== C2-A 驗證：ProviderRegistry（純邏輯） ===");

  const registry = new ProviderRegistry();
  const enabledProvider = createFakeProvider({ key: "p-enabled", behavior: "success", enabled: true });
  const disabledProvider = createFakeProvider({ key: "p-disabled", behavior: "success", enabled: false });

  registry.register(enabledProvider);
  registry.register(disabledProvider);

  check("[R1] register／get：可註冊並依 key 取回同一個 Provider", registry.get("p-enabled") === enabledProvider);
  check("[R2] list：列舉出所有已註冊的 Provider", registry.list().length === 2);
  check("[R3] has：可查詢 key 是否存在", registry.has("p-enabled") === true && registry.has("not-registered") === false);

  const registryForDup = new ProviderRegistry();
  registryForDup.register(createFakeProvider({ key: "dup-key", behavior: "success" }));
  expectRegisterDuplicateRejected(registryForDup);

  function expectRegisterDuplicateRejected(reg: ProviderRegistry) {
    try {
      reg.register(createFakeProvider({ key: "dup-key", behavior: "success" }));
      failCount++;
      console.log("  FAIL  [R4] register：重複 key 應被拒絕，但未拋出例外");
    } catch (err) {
      check("[R4] register：重複 key 拒絕，拋出 AuthProviderConfigurationError", err instanceof AuthProviderConfigurationError);
    }
  }

  try {
    registry.get("does-not-exist");
    failCount++;
    console.log("  FAIL  [R5] get：查詢不存在的 key 應拋出例外，但未拋出");
  } catch (err) {
    check("[R5] get：查詢不存在的 key 拋出 AuthProviderNotFoundError", err instanceof AuthProviderNotFoundError);
  }

  check("[R6] getEnabledOrThrow：enabled 的 Provider 正常回傳", registry.getEnabledOrThrow("p-enabled") === enabledProvider);
  try {
    registry.getEnabledOrThrow("p-disabled");
    failCount++;
    console.log("  FAIL  [R7] getEnabledOrThrow：disabled 的 Provider 應被拒絕，但未拋出例外");
  } catch (err) {
    check("[R7] getEnabledOrThrow：disabled 的 Provider 拒絕，拋出 AuthProviderUnavailableError", err instanceof AuthProviderUnavailableError);
  }

  const independentRegistry = new ProviderRegistry();
  check(
    "[R8] 非全域 singleton：另一個 ProviderRegistry 實例互不影響（不會看到前面註冊的 Provider）",
    independentRegistry.list().length === 0 && independentRegistry.has("p-enabled") === false,
  );
}

// ===========================================================================
// 3. Factory
// ===========================================================================
async function runFactoryTests() {
  console.log("\n=== C2-A 驗證：ProviderFactory（純邏輯） ===");

  const localProvider = createProviderFromConfig(fakeConfig({ key: "local-x", kind: "LOCAL", enabled: true }));
  check("[F1] createProviderFromConfig：kind=LOCAL 成功建立，descriptor.kind 正確", localProvider.descriptor.kind === "LOCAL");
  check("[F2] createProviderFromConfig：建立出的 descriptor.key 與輸入一致", localProvider.descriptor.key === "local-x");

  await expectError(
    "[F3] createProviderFromConfig：kind=LDAP 通過設定驗證，但建立時明確拋出未實作錯誤（非假裝可運作）",
    () => createProviderFromConfig(fakeConfig({ key: "ldap-x", kind: "LDAP" })),
    (e) => e instanceof AuthProviderConfigurationError && /尚未實作/.test((e as Error).message),
  );
  await expectError(
    "[F3b] createProviderFromConfig：kind=OIDC 同樣明確拋出未實作錯誤",
    () => createProviderFromConfig(fakeConfig({ key: "oidc-x", kind: "OIDC" })),
    (e) => e instanceof AuthProviderConfigurationError && /尚未實作/.test((e as Error).message),
  );
  await expectError(
    "[F3c] createProviderFromConfig：kind=SAML 同樣明確拋出未實作錯誤",
    () => createProviderFromConfig(fakeConfig({ key: "saml-x", kind: "SAML" })),
    (e) => e instanceof AuthProviderConfigurationError && /尚未實作/.test((e as Error).message),
  );
  await expectError(
    "[F4] createProviderFromConfig：不支援的 kind（設定驗證階段即拒絕）",
    () => createProviderFromConfig({ key: "unknown-x", kind: "KERBEROS", displayName: "x", enabled: true }),
    (e) => e instanceof AuthProviderConfigurationError,
  );
}

// ===========================================================================
// 4. LocalProvider — Identity Normalization
// ===========================================================================
async function runLocalProviderTests() {
  console.log("\n=== C2-A 驗證：LocalProvider（純邏輯，不觸碰 Session／Prisma） ===");

  const provider = createLocalProvider(fakeConfig({ key: "local-verify", kind: "LOCAL", enabled: true }));

  await checkAsync("[L1] LocalProvider.authenticate：合法輸入正規化成功", async () => {
    const result = await provider.authenticate({
      subject: "user-001",
      loginIdentifier: "alice",
      displayName: "Alice",
      email: "alice@example.invalid",
      department: "PMO",
      groups: ["group-a", "group-b"],
      ldapSpecificClaim: "should-not-leak",
    });
    return (
      result.ok === true &&
      result.identity.providerKey === "local-verify" &&
      result.identity.loginIdentifier === "alice" &&
      result.identity.groups.length === 2 &&
      // 專有 claim 名稱不得出現在正規化後身分的任何欄位值中
      JSON.stringify(result.identity).includes("should-not-leak") === false
    );
  });

  await checkAsync("[L2] LocalProvider.authenticate：缺少必要欄位（subject）時回傳失敗，不拋出例外", async () => {
    const result = await provider.authenticate({ loginIdentifier: "bob", displayName: "Bob" });
    return result.ok === false && typeof result.reason === "string";
  });

  await checkAsync("[L3] LocalProvider.authenticate：輸入非物件時回傳失敗", async () => {
    const result = await provider.authenticate("not-an-object");
    return result.ok === false;
  });

  await checkAsync("[L4] LocalProvider.checkHealth：回傳 HEALTHY", async () => (await provider.checkHealth()).status === "HEALTHY");

  const disabled = createLocalProvider(fakeConfig({ key: "local-disabled", kind: "LOCAL", enabled: false }));
  check("[L5] LocalProvider descriptor.enabled 反映設定值（此處為 false）", disabled.descriptor.enabled === false);
}

// ===========================================================================
// 5. FakeProvider
// ===========================================================================
async function runFakeProviderTests() {
  console.log("\n=== C2-A 驗證：FakeProvider（測試輔助本身也需驗證） ===");

  const successProvider = createFakeProvider({
    key: "fake-success",
    behavior: "success",
    identity: createFakeIdentity({ providerKey: "fake-success", loginIdentifier: "carol" }),
  });
  await checkAsync("[FP1] FakeProvider：behavior=success 回傳 ok=true 與指定身分", async () => {
    const result = await successProvider.authenticate({});
    return result.ok === true && result.identity.loginIdentifier === "carol";
  });

  const failureProvider = createFakeProvider({ key: "fake-failure", behavior: "failure", failureReason: "模擬驗證失敗" });
  await checkAsync("[FP2] FakeProvider：behavior=failure 回傳 ok=false 與指定原因", async () => {
    const result = await failureProvider.authenticate({});
    return result.ok === false && result.reason === "模擬驗證失敗";
  });

  const degradedProvider = createFakeProvider({ key: "fake-degraded", behavior: "success", healthStatus: "DEGRADED" });
  await checkAsync("[FP3] FakeProvider：checkHealth 可設定為 DEGRADED", async () => (await degradedProvider.checkHealth()).status === "DEGRADED");
}

// ===========================================================================
// 6. 錯誤模型與 redaction
// ===========================================================================
function runErrorTests() {
  console.log("\n=== C2-A 驗證：錯誤模型與 redaction（純邏輯） ===");

  check("[E1] isKnownAuthProviderError：已知錯誤類型辨識為 true", isKnownAuthProviderError(new AuthProviderIdentityError("x")));
  check("[E2] isKnownAuthProviderError：一般 Error 辨識為 false", !isKnownAuthProviderError(new Error("plain")));

  check(
    "[E3] containsSensitiveContent：含 password= 樣式的字串被偵測到",
    containsSensitiveContent("login failed, password=hunter2 was rejected"),
  );
  check(
    "[E4] containsSensitiveContent：含 Bearer token 的字串被偵測到",
    containsSensitiveContent("upstream call failed: Authorization: Bearer abc.def.ghi"),
  );
  check("[E5] containsSensitiveContent：一般訊息不誤判", !containsSensitiveContent("provider is temporarily unavailable"));

  check(
    "[E6] redactMessage：偵測到敏感內容時改回固定訊息，不外洩原始內容",
    redactMessage("bind failed, password=leak-me") !== "bind failed, password=leak-me",
  );
  check("[E7] redactMessage：一般訊息維持原樣", redactMessage("provider timeout") === "provider timeout");

  const safeErr = toSafeProviderError(new Error("SQLITE_ERROR at /secret/path with password=abc"), "服務暫時無法使用");
  check(
    "[E8] toSafeProviderError：轉換後的錯誤訊息只會是固定訊息，不含原始例外內容",
    safeErr instanceof AuthProviderUnavailableError && safeErr.message === "服務暫時無法使用" && !safeErr.message.includes("password"),
  );

  check(
    "[E9] 五種錯誤類型皆可正確建構且 name／message 對應正確",
    (() => {
      const cases: [Error, string][] = [
        [new AuthProviderConfigurationError("a"), "AuthProviderConfigurationError"],
        [new AuthProviderUnavailableError("b"), "AuthProviderUnavailableError"],
        [new AuthProviderAuthenticationError("c"), "AuthProviderAuthenticationError"],
        [new AuthProviderIdentityError("d"), "AuthProviderIdentityError"],
        [new AuthProviderNotFoundError("e"), "AuthProviderNotFoundError"],
      ];
      return cases.every(([err, name]) => err.name === name);
    })(),
  );
}

// ===========================================================================
// 7. Identity Mapping 純函式
// ===========================================================================
function runIdentityMappingTests() {
  console.log("\n=== C2-A 驗證：Identity Mapping 純函式（不寫入任何資料） ===");

  const identity = normalizeIdentity("verify-provider", {
    subject: "sub-1",
    loginIdentifier: "dave",
    displayName: "Dave",
    email: "Dave@Example.invalid",
    department: "Eng",
    groups: ["g1", "g2", 42, null],
    someVendorSpecificClaim: "vendor-secret-shape",
  });

  check("[I1] normalizeIdentity：正確擷取白名單欄位", identity.subject === "sub-1" && identity.loginIdentifier === "dave");
  check("[I2] normalizeIdentity：groups 內非字串項目被過濾掉", identity.groups.length === 2);
  check(
    "[I3] normalizeIdentity：rawClaimsReference 只描述欄位數與已知欄位鍵名，不含任何欄位值",
    identity.rawClaimsReference.fieldCount === 7 && !JSON.stringify(identity.rawClaimsReference).includes("vendor-secret-shape"),
  );

  check("[I4] validateNormalizedIdentity：合法身分通過驗證", validateNormalizedIdentity(identity).valid === true);
  check(
    "[I5] validateNormalizedIdentity：email 格式不正確時拒絕",
    validateNormalizedIdentity({ ...identity, email: "not-an-email" }).valid === false,
  );
  check(
    "[I6] validateNormalizedIdentity：subject 為空字串時拒絕",
    validateNormalizedIdentity({ ...identity, subject: "" }).valid === false,
  );

  checkNormalizeIdentityThrows();
  function checkNormalizeIdentityThrows() {
    try {
      normalizeIdentity("verify-provider", { loginIdentifier: "x", displayName: "y" });
      failCount++;
      console.log("  FAIL  [I7] normalizeIdentity：缺少 subject 應拋出例外，但未拋出");
    } catch (err) {
      check("[I7] normalizeIdentity：缺少 subject 拋出 AuthProviderIdentityError", err instanceof AuthProviderIdentityError);
    }
    try {
      normalizeIdentity("verify-provider", "not-an-object");
      failCount++;
      console.log("  FAIL  [I8] normalizeIdentity：輸入非物件應拋出例外，但未拋出");
    } catch (err) {
      check("[I8] normalizeIdentity：輸入非物件拋出 AuthProviderIdentityError", err instanceof AuthProviderIdentityError);
    }
  }

  check(
    "[I9] mapExternalGroups：只保留白名單內對應的群組，未對應的外部群組被捨棄（不得原樣放行）",
    (() => {
      const mapped = mapExternalGroups(["ext-a", "ext-unmapped", "ext-b"], { "ext-a": "internal-a", "ext-b": "internal-b" });
      return mapped.length === 2 && mapped.includes("internal-a") && mapped.includes("internal-b") && !mapped.includes("ext-unmapped");
    })(),
  );
  check("[I10] mapExternalGroups：空白名單時回傳空陣列", mapExternalGroups(["ext-a"], {}).length === 0);

  check(
    "[I11] compareIdentityLinkCandidate：loginIdentifier 相同時判定為候選連結，matchedOn=loginIdentifier",
    (() => {
      const result = compareIdentityLinkCandidate(identity, { loginIdentifier: "dave", email: "someone-else@example.invalid" });
      return result.matched === true && result.matchedOn === "loginIdentifier";
    })(),
  );
  check(
    "[I12] compareIdentityLinkCandidate：email 相同（忽略大小寫）時判定為候選連結",
    (() => {
      const result = compareIdentityLinkCandidate(identity, { loginIdentifier: "someone-else", email: "dave@example.invalid" });
      return result.matched === true && result.matchedOn === "email";
    })(),
  );
  check(
    "[I13] compareIdentityLinkCandidate：皆不相符時 matched=false",
    (() => {
      const result = compareIdentityLinkCandidate(identity, { loginIdentifier: "nope", email: "nope@example.invalid" });
      return result.matched === false && result.matchedOn === null;
    })(),
  );
}

// ===========================================================================
// 8. 原始碼層級邊界檢查
// ===========================================================================
const REPO_ROOT = path.resolve(__dirname, "..");
const MODULE_DIR = path.join(REPO_ROOT, "src/lib/auth-providers");

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

function listModuleFiles(): string[] {
  const results: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".ts")) results.push(full);
    }
  };
  walk(MODULE_DIR);
  return results;
}

function gitDiffEmpty(baseRef: string, relPath: string): boolean {
  try {
    const out = execFileSync("git", ["diff", baseRef, "--", relPath], { cwd: REPO_ROOT, encoding: "utf8" });
    return out.trim().length === 0;
  } catch (err) {
    throw new Error(`git diff 檢查失敗（${relPath}）：${err instanceof Error ? err.message : String(err)}`);
  }
}

// 整合場景（M2-A + C2-A）下，C2-A 自己的封板基準（m1-5-c1-c-complete）已不適用於
// 「整個 repo 完全零差異」這個假設——M2-A 合法地修改了 schema.prisma／permissions.ts／
// migrations。C2_A_BASE_REF 讓呼叫端明確指定「這次比對基準應該是什麼」：
// - 未設定時預設仍為 m1-5-c1-c-complete，維持 C2-A 獨立封板時的原始語意，不影響
//   獨立 C2-A branch 的既有行為。
// - 設定時（例如整合腳本傳入 C2_A_BASE_REF=m2-a-complete），必須能解析為有效 commit，
//   且必須是目前 HEAD 的祖先；任一條件不成立一律 fail closed（直接 process.exit(1)），
//   不得靜默退回其他 tag 或跳過檢查。
// 解析結果一律使用完整 commit hash（而非原始 ref 字串），避免同名 tag 未來被移動後
// 這裡的比對基準跟著漂移。
function resolveBaseRef(): { ref: string; isExplicitOverride: boolean } {
  const envRef = process.env.C2_A_BASE_REF;
  const isExplicitOverride = !!(envRef && envRef.trim());
  const requestedRef = isExplicitOverride ? envRef.trim() : "m1-5-c1-c-complete";

  let resolvedCommit: string;
  try {
    resolvedCommit = execFileSync("git", ["rev-parse", "--verify", `${requestedRef}^{commit}`], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    console.error(`拒絕執行：C2_A_BASE_REF="${requestedRef}" 無法解析為有效 commit。`);
    process.exit(1);
  }

  try {
    execFileSync("git", ["merge-base", "--is-ancestor", resolvedCommit, "HEAD"], { cwd: REPO_ROOT });
  } catch {
    console.error(`拒絕執行：C2_A_BASE_REF="${requestedRef}"（解析為 ${resolvedCommit}）不是目前 HEAD 的祖先，無法作為比對基準。`);
    process.exit(1);
  }

  return { ref: resolvedCommit, isExplicitOverride };
}

// C2-A 自己的範圍：src/lib/auth-providers/** 與 scripts/c2_a-verify.ts。
// 額外允許 scripts/m1_5_c1_a-verify.ts：這是另一條獨立授權、獨立以 20 次連續穩定驗證過
// 的修復（fix/c1-a-verify-temp-table-connection，修正 TEMP TABLE 連線競態），依整合計畫
// 本就會與 C2-A cherry-pick 一起存在於同一個整合 branch，不是 C2-A cherry-pick 自己
// 帶入的範圍外變動——B10 檢查的目的是攔截「C2-A cherry-pick 造成的」範圍外差異，不是
// 攔截整合 branch 上其他已授權、已驗證的獨立修復。
const ALLOWED_INTEGRATION_PATH_PATTERNS = [
  /^src\/lib\/auth-providers\//,
  /^scripts\/c2_a-verify\.ts$/,
  /^scripts\/m1_5_c1_a-verify\.ts$/,
];

function listChangedFiles(baseRef: string): string[] {
  try {
    const out = execFileSync("git", ["diff", "--name-only", baseRef], { cwd: REPO_ROOT, encoding: "utf8" });
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch (err) {
    throw new Error(`git diff --name-only 檢查失敗：${err instanceof Error ? err.message : String(err)}`);
  }
}

function runBoundaryChecks() {
  console.log("\n=== C2-A 驗證：模組邊界與紅線檔案未變動（原始碼層級靜態檢查） ===");

  const moduleFiles = listModuleFiles();
  check("[B0] auth-providers 模組確實存在檔案（非空殼）", moduleFiles.length >= 8);

  let prismaImportViolation: string | null = null;
  let nextHeadersViolation: string | null = null;
  let uiImportViolation: string | null = null;
  let anyClaimsViolation: string | null = null;

  for (const file of moduleFiles) {
    const src = fs.readFileSync(file, "utf8");
    const rel = path.relative(REPO_ROOT, file);
    if (/@prisma\/client/.test(src) || /@\/lib\/prisma["']/.test(src)) prismaImportViolation = rel;
    if (/from\s*["']next\/headers["']/.test(src)) nextHeadersViolation = rel;
    if (/@\/components\//.test(src) || /@\/app\//.test(src)) uiImportViolation = rel;
    // 排除本檔案的說明文字本身使用到 "unknown" 一詞；只檢查是否把 claims 型別直接標成 any
    if (/claims\s*:\s*any\b/i.test(src)) anyClaimsViolation = rel;
  }

  check("[B1] auth-providers 模組內沒有任何檔案 import Prisma", prismaImportViolation === null);
  check("[B2] auth-providers 模組內沒有任何檔案 import next/headers（不接管 Session／Cookie）", nextHeadersViolation === null);
  check("[B3] auth-providers 模組內沒有任何檔案 import UI 層（src/components、src/app）", uiImportViolation === null);
  check('[B4] auth-providers 模組內沒有把 claims 直接標註為 "any"', anyClaimsViolation === null);

  let userWriteViolation: string | null = null;
  for (const file of moduleFiles) {
    const src = fs.readFileSync(file, "utf8");
    if (/prisma\.(user|userRole|teamMembership)\./i.test(src)) userWriteViolation = path.relative(REPO_ROOT, file);
  }
  check("[B5] auth-providers 模組內沒有任何 User／UserRole／TeamMembership 寫入呼叫", userWriteViolation === null);

  const indexSrc = readSource("src/lib/auth-providers/index.ts");
  check(
    "[B6] index.ts 沒有建立全域可變 singleton（不得有 `new ProviderRegistry()` 之類的模組層級實例）",
    !/new\s+ProviderRegistry\s*\(/.test(indexSrc),
  );

  const configSrc = readSource("src/lib/auth-providers/config.ts");
  const secretRefBlockMatch = configSrc.match(/interface SecretReference \{[\s\S]*?\}/);
  check(
    "[B7] SecretReference 型別定義本身不存在（找不到）",
    secretRefBlockMatch !== null,
  );
  check(
    "[B7b] SecretReference 型別內沒有任何叫做 value／secret／password 的欄位",
    secretRefBlockMatch !== null && !/\b(value|secret|password)\s*[?:]/i.test(secretRefBlockMatch[0]),
  );

  const { ref: BASE_REF, isExplicitOverride } = resolveBaseRef();
  const protectedFiles = [
    "prisma/schema.prisma",
    "prisma/seed.ts",
    "src/lib/auth.ts",
    "src/lib/permissions.ts",
    "src/components/Nav.tsx",
    "package.json",
    "package-lock.json",
  ];
  for (const relPath of protectedFiles) {
    check(`[B8] ${relPath} 相對於指定比對基準（${BASE_REF}）完全未變動`, gitDiffEmpty(BASE_REF, relPath));
  }
  check(
    "[B8b] prisma/migrations 目錄相對於指定比對基準完全未變動（C2-A 沒有新增 Migration）",
    gitDiffEmpty(BASE_REF, "prisma/migrations"),
  );

  const packageJsonDiffEmpty = gitDiffEmpty(BASE_REF, "package.json");
  check("[B9] package.json 未新增任何套件（與指定比對基準逐字相同）", packageJsonDiffEmpty);

  // 整合場景下的白名單檢查：只在明確以 C2_A_BASE_REF 覆寫比對基準時才啟用（例如整合腳本傳入
  // C2_A_BASE_REF=m2-a-complete），不影響獨立 C2-A branch 用預設基準時的既有斷言總數。
  // 相對於指定比對基準的「所有」變動檔案，都必須落在 C2-A 自己的範圍
  // （src/lib/auth-providers/** 或 scripts/c2_a-verify.ts）內；整合場景下若出現任何
  // C2-A cherry-pick 之外造成的額外檔案差異（不論來源），這裡會立即攔截。
  if (isExplicitOverride) {
    const changedFiles = listChangedFiles(BASE_REF);
    const outOfScope = changedFiles.filter((f) => !ALLOWED_INTEGRATION_PATH_PATTERNS.some((p) => p.test(f)));
    check(
      `[B10] 相對於指定整合基準（${BASE_REF}）的所有變動檔案皆限於 src/lib/auth-providers/** 或 scripts/c2_a-verify.ts`,
      outOfScope.length === 0,
    );
    if (outOfScope.length > 0) {
      console.log(`    超出範圍的檔案：${outOfScope.join(", ")}`);
    }
  }
}

// ===========================================================================
// main
// ===========================================================================
async function main() {
  console.log("=== M1.5-C2-A 驗證：Authentication Provider 抽象層 ===");

  runConfigTests();
  runRegistryTests();
  await runFactoryTests();
  await runLocalProviderTests();
  await runFakeProviderTests();
  runErrorTests();
  runIdentityMappingTests();
  runBoundaryChecks();

  console.log(`\n=== 結果：PASS=${passCount} FAIL=${failCount} SKIP=${skipCount} ===`);

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("c2_a-verify 執行時發生未預期錯誤：", err);
  process.exit(1);
});
