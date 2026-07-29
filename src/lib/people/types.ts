// C1-B3 新增：People 領域共用型別與錯誤類別。
//
// 本檔案刻意不 import Prisma、不執行任何查詢——純型別與純邏輯用的錯誤類別，
// 供本目錄下其他模組與 src/lib/peopleService.ts facade 共用（呼叫端 import 型別
// 一律從 peopleService.ts 或 index.ts 取得，不直接深入 import 本目錄內部檔案）。

import type { RoleKey } from "../constants";

export class PeopleValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`People 服務驗證失敗：${issues.join("; ")}`);
    this.name = "PeopleValidationError";
  }
}

export class PeopleNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeopleNotFoundError";
  }
}

export class PeopleStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeopleStateError";
  }
}

export class PeopleAccessDeniedError extends Error {
  constructor(message: string = "沒有權限執行此操作") {
    super(message);
    this.name = "PeopleAccessDeniedError";
  }
}

// ---------------------------------------------------------------------------
// profileService 輸入型別
// ---------------------------------------------------------------------------

export interface CreatePersonInput {
  name: string;
  email: string;
  department?: string;
  // C1-C 新增：loginIdentifier 為 C1-A 已建立的既有欄位（唯一，可選），本階段只負責
  // 讓使用者可自行填寫／留空，不回填、不猜測、不修改登入流程。
  loginIdentifier?: string | null;
  initialRole: RoleKey; // 必填：createPerson 一律同時建立對應的 active UserRole
  actorId: string;
  reasonCode: string;
  /** 團隊主管操作時必填：指定操作範圍所在團隊；Admin 可省略（跨團隊）。見 people/access.ts */
  teamScopeId?: string | null;
}

export interface UpdatePersonProfileInput {
  userId: string;
  name?: string;
  department?: string;
  loginIdentifier?: string | null;
  actorId: string;
  reasonCode: string;
  /** 團隊主管操作時必填：指定操作範圍所在團隊；Admin 可省略（跨團隊）。見 people/access.ts */
  teamScopeId?: string | null;
}

export interface ActivatePersonInput {
  userId: string;
  actorId: string;
  reasonCode: string;
  /** 團隊主管操作時必填：指定操作範圍所在團隊；Admin 可省略（跨團隊）。見 people/access.ts */
  teamScopeId?: string | null;
}

// ---------------------------------------------------------------------------
// roleService 輸入型別
// ---------------------------------------------------------------------------

export interface AssignSystemRoleInput {
  userId: string;
  role: RoleKey;
  actorId: string;
  reasonCode: string;
  /** 團隊主管操作時必填：指定操作範圍所在團隊；Admin 可省略（跨團隊）。見 people/access.ts */
  teamScopeId?: string | null;
}

export interface UpdatePrimaryRoleInput {
  userId: string;
  role: RoleKey;
  actorId: string;
  reasonCode: string;
  /** 團隊主管操作時必填：指定操作範圍所在團隊；Admin 可省略（跨團隊）。見 people/access.ts */
  teamScopeId?: string | null;
}

export interface RemoveSystemRoleInput {
  userId: string;
  role: RoleKey;
  actorId: string;
  reasonCode: string;
  /** 團隊主管操作時必填：指定操作範圍所在團隊；Admin 可省略（跨團隊）。見 people/access.ts */
  teamScopeId?: string | null;
}

// ---------------------------------------------------------------------------
// teamMembershipService 輸入型別
// ---------------------------------------------------------------------------

export interface AddTeamMemberInput {
  teamId: string;
  userId: string;
  actorId: string;
  reasonCode: string;
}

export interface RemoveTeamMemberInput {
  teamId: string;
  userId: string;
  actorId: string;
  reasonCode: string;
}

// ---------------------------------------------------------------------------
// deactivationService 型別
// ---------------------------------------------------------------------------

export type DeactivationImpactSeverity = "blocking" | "warning";

export interface DeactivationImpactItem {
  severity: DeactivationImpactSeverity;
  blocking: boolean;
  category: string;
  message: string;
  relatedEntityId: string | null;
  suggestedAction: string;
}

export interface GetUserDeactivationImpactInput {
  userId: string;
  actorId: string;
}

export interface DeactivatePersonInput {
  userId: string;
  actorId: string;
  reasonCode: string;
  /** 團隊主管操作時必填：指定操作範圍所在團隊；Admin 可省略（跨團隊）。見 people/access.ts */
  teamScopeId?: string | null;
}
