// M1 新增：系統 → 負責團隊自動路由判斷
//
// 規則（不得放寬，未來里程碑如需調整需另行核准）：
// 1. 只有在「唯一一筆有效（isActive）且 isPrimary」的對應時，才自動路由到該團隊。
// 2. 完全沒有對應（mapping）時，進分流（Triage），不得臆測。
// 3. 有對應但沒有任何一筆被標記為 isPrimary（或所有 isPrimary 皆為非啟用）時，進分流。
// 4. 有多筆有效且 isPrimary 的對應時，視為設定錯誤（configError），必須回報，不得任選其一。
//
// decideSystemTeamRouting 為純邏輯函式，輸入為「已鎖定同一 systemId + responsibilityType」的
// SystemTeamMapping 候選清單，不依賴 Prisma，可在 Migration 套用前單元測試。
// routeSystemTeam 為 DB 查詢版本，需 SystemTeamMapping 資料表已存在，須等 M1-B 套用 Migration 後才能實際驗證。

import { prisma } from "./prisma";

// SQLite connector 不支援原生 enum，SystemTeamMapping.responsibilityType 於 Prisma Schema 中為 String（值域見該欄位註解）
export type SystemResponsibilityTypeValue = "RD" | "QA" | "OP" | "OTHER";

export interface SystemTeamMappingLike {
  id: string;
  teamId: string;
  isPrimary: boolean;
  isActive: boolean;
}

export type RoutingDecision =
  | { kind: "routed"; teamId: string; mappingId: string }
  | { kind: "triage"; reason: "noMapping" | "noUniquePrimary" }
  | { kind: "configError"; reason: "multiplePrimary"; conflictingTeamIds: string[]; conflictingMappingIds: string[] };

// 純邏輯：輸入須為同一 (systemId, responsibilityType) 的候選對應清單
export function decideSystemTeamRouting(candidates: readonly SystemTeamMappingLike[]): RoutingDecision {
  const active = candidates.filter((m) => m.isActive);

  if (active.length === 0) {
    return { kind: "triage", reason: "noMapping" };
  }

  const primaries = active.filter((m) => m.isPrimary);

  if (primaries.length === 0) {
    return { kind: "triage", reason: "noUniquePrimary" };
  }

  if (primaries.length > 1) {
    return {
      kind: "configError",
      reason: "multiplePrimary",
      conflictingTeamIds: primaries.map((m) => m.teamId),
      conflictingMappingIds: primaries.map((m) => m.id),
    };
  }

  const [only] = primaries;
  return { kind: "routed", teamId: only.teamId, mappingId: only.id };
}

// DB 查詢版本：需 SystemTeamMapping 資料表已存在（M1-B 套用 Migration 後）
export async function routeSystemTeam(
  systemId: string,
  responsibilityType: SystemResponsibilityTypeValue,
): Promise<RoutingDecision> {
  const candidates = await prisma.systemTeamMapping.findMany({
    where: { systemId, responsibilityType },
  });
  return decideSystemTeamRouting(candidates);
}
