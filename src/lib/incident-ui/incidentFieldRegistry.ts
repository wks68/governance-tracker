// Incident IssueFieldValue 欄位 Key 單一集中定義（任務規格第十一節）。新增的結構化通報
// 欄位一律從這裡取得 Key／Label，不得在 incidentCreation.ts、pageContext.ts、列表或測試各自
//重複硬編字串，避免同一欄位在不同檔案打錯字而變成兩個不同欄位。
//
// Stage 1／Phase 2 既有欄位 Key（incidentType／incidentOccurredAt／incidentSuggestedSeverity／
// incidentIsOngoing／incidentHasWorkaround／incidentAffectedScope／incidentImpactSummary 等）
// 已分散在 incidentCreation.ts／incidentAssignmentService.ts 沿用至今，本輪不強行搬遷既有
// 讀寫端（風險大於收益），只把「本輪新增」的欄位集中在這裡，供 Server／UI／Test 三方共用。

export const INCIDENT_FIELD = {
  occurredAtUncertain: "incidentOccurredAtUncertain",
  symptomText: "incidentSymptomText",
  symptomTags: "incidentSymptomTags",
  workaroundNote: "incidentWorkaroundNote",
  impactScope: "incidentImpactScopeValue",
  affectedUserIds: "incidentAffectedUserIds",
  affectedTeamIds: "incidentAffectedTeamIds",
  dataPermissionImpact: "incidentDataPermissionImpact",
  operationalImpact: "incidentOperationalImpact",
  operationalImpactOtherNote: "incidentOperationalImpactOtherNote",
  suggestedImpactLevel: "incidentSuggestedImpactLevel",
  contactMethod: "incidentContactMethod",
  contactDetail: "incidentContactDetail",
  autoSummary: "incidentAutoSummary",
} as const;

export type IncidentFieldKey = (typeof INCIDENT_FIELD)[keyof typeof INCIDENT_FIELD];

export const INCIDENT_FIELD_LABEL: Record<IncidentFieldKey, string> = {
  [INCIDENT_FIELD.occurredAtUncertain]: "發生時間是否不確定",
  [INCIDENT_FIELD.symptomText]: "問題現象",
  [INCIDENT_FIELD.symptomTags]: "常見症狀",
  [INCIDENT_FIELD.workaroundNote]: "目前可以怎麼暫時處理",
  [INCIDENT_FIELD.impactScope]: "影響範圍（正式值）",
  [INCIDENT_FIELD.affectedUserIds]: "受影響使用者",
  [INCIDENT_FIELD.affectedTeamIds]: "受影響單位",
  [INCIDENT_FIELD.dataPermissionImpact]: "資料與權限影響",
  [INCIDENT_FIELD.operationalImpact]: "初步營運影響",
  [INCIDENT_FIELD.operationalImpactOtherNote]: "其他營運影響說明",
  [INCIDENT_FIELD.suggestedImpactLevel]: "通報人初步影響感受",
  [INCIDENT_FIELD.contactMethod]: "聯絡方式",
  [INCIDENT_FIELD.contactDetail]: "聯絡資訊",
  [INCIDENT_FIELD.autoSummary]: "系統自動整理摘要",
};
