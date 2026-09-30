export const ROLES = [
  "PM",
  "RD",
  "QA",
  "OP",
  "Security",
  "DMS Manager",
  "Admin"
] as const;

export const ISSUE_TYPES = [
  "Hotfix",
  "Incident",
  "RCA",
  "Risk Exception",
  "QA Verification",
  "Change / Release",
  "Monitoring Inventory",
  "Backup / Recovery Test"
] as const;

export const ENVIRONMENTS = ["Production", "Staging", "UAT", "DR", "Internal"] as const;
export const RISK_LEVELS = ["Low", "Medium", "High", "Critical"] as const;
export const PRIORITIES = ["P1", "P2", "P3", "P4"] as const;
export const STATUS_LIGHTS = ["Red", "Yellow", "Blue", "Green", "Gray"] as const;

export type IssueTypeName = (typeof ISSUE_TYPES)[number];
export type StatusLight = (typeof STATUS_LIGHTS)[number];
export type DynamicFieldType = "text" | "textarea" | "select" | "number" | "datetime-local";

export type DynamicFieldTemplate = {
  key: string;
  label: string;
  type: DynamicFieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[];
};

export const WORKFLOWS: Record<IssueTypeName, string[]> = {
  Hotfix: [
    "Submitted",
    "Hotfix Review",
    "Impact Assessment",
    "RD Fixing",
    "RD Self-Test Done",
    "QA Verifying",
    "QA Approved",
    "OP Releasing",
    "Production Confirming",
    "Closure Review",
    "Closed"
  ],
  Incident: [
    "Reported",
    "Initial Assessment",
    "Initial Handling",
    "RCA Decision",
    "Improvement Tracking",
    "Verification",
    "Closed"
  ],
  RCA: [
    "Created",
    "Analyzing",
    "Corrective Action",
    "Preventive Action",
    "Tracking",
    "Verification",
    "Closed"
  ],
  "Risk Exception": [
    "Requested",
    "Risk Review",
    "Pending Approval",
    "Approved",
    "Tracking",
    "Verification",
    "Closed"
  ],
  "QA Verification": ["Created", "Testing", "Retesting", "Release Decision", "Closed"],
  "Change / Release": [
    "Created",
    "Release Review",
    "Releasing",
    "Production Confirmation",
    "Closed"
  ],
  "Monitoring Inventory": ["Draft", "Reviewing", "Active", "Need Update", "Closed"],
  "Backup / Recovery Test": [
    "Planned",
    "Backup Confirming",
    "Recovery Testing",
    "Verification",
    "Closed"
  ]
};

export const DYNAMIC_FIELDS: Record<IssueTypeName, DynamicFieldTemplate[]> = {
  Hotfix: [
    {
      key: "impactScope",
      label: "Impact Scope",
      type: "textarea",
      required: true,
      placeholder: "受影響服務、使用者族群、資料範圍與回復邊界。"
    },
    {
      key: "rdFixSummary",
      label: "RD Fix Summary",
      type: "textarea",
      required: true
    },
    {
      key: "rdSelfTestResult",
      label: "RD Self-Test Result",
      type: "textarea",
      required: true
    },
    {
      key: "qaResult",
      label: "QA Result",
      type: "select",
      options: ["", "Passed", "Conditional Passed", "Failed"]
    },
    {
      key: "productionConfirmationResult",
      label: "Production Confirmation Result",
      type: "textarea"
    }
  ],
  Incident: [
    {
      key: "incidentLevel",
      label: "Incident Level",
      type: "select",
      required: true,
      options: ["", "Low", "Medium", "High"]
    },
    {
      key: "detectionTime",
      label: "Detection Time",
      type: "datetime-local"
    },
    {
      key: "impactedServices",
      label: "Impacted Services",
      type: "textarea"
    },
    {
      key: "initialHandlingResult",
      label: "Initial Handling Result",
      type: "textarea"
    }
  ],
  RCA: [
    {
      key: "rootCauseSummary",
      label: "Root Cause Summary",
      type: "textarea",
      required: true
    },
    {
      key: "correctiveAction",
      label: "Corrective Action",
      type: "textarea",
      required: true
    },
    {
      key: "preventiveAction",
      label: "Preventive Action",
      type: "textarea",
      required: true
    },
    {
      key: "verificationResult",
      label: "Verification Result",
      type: "textarea"
    }
  ],
  "Risk Exception": [
    {
      key: "riskDescription",
      label: "Risk Description",
      type: "textarea",
      required: true
    },
    {
      key: "temporaryRiskReductionMeasure",
      label: "Temporary Risk Reduction Measure",
      type: "textarea",
      required: true
    },
    {
      key: "followUpPlan",
      label: "Follow-up Plan",
      type: "textarea",
      required: true
    },
    {
      key: "approvalRole",
      label: "Approval Role",
      type: "select",
      options: ["", "Security", "DMS Manager", "Admin"]
    },
    {
      key: "verificationResult",
      label: "Verification Result",
      type: "textarea"
    }
  ],
  "QA Verification": [
    {
      key: "testItems",
      label: "Test Items",
      type: "textarea",
      required: true
    },
    {
      key: "qaResult",
      label: "QA Result",
      type: "select",
      required: true,
      options: ["", "Passed", "Conditional Passed", "Failed"]
    },
    {
      key: "releaseDecisionNote",
      label: "Release Decision Note",
      type: "textarea"
    }
  ],
  "Change / Release": [
    {
      key: "releaseVersion",
      label: "Release Version",
      type: "text",
      required: true
    },
    {
      key: "rollbackPlan",
      label: "Rollback Plan",
      type: "textarea",
      required: true
    },
    {
      key: "productionConfirmationResult",
      label: "Production Confirmation Result",
      type: "textarea"
    }
  ],
  "Monitoring Inventory": [
    {
      key: "componentName",
      label: "Component Name",
      type: "text",
      required: true
    },
    {
      key: "monitoringItems",
      label: "Monitoring Items",
      type: "textarea",
      required: true
    },
    {
      key: "alertLevel",
      label: "Alert Level",
      type: "select",
      options: ["", "Normal", "Warning", "Critical"]
    },
    {
      key: "alertCondition",
      label: "Alert Condition",
      type: "textarea"
    },
    {
      key: "notificationMethod",
      label: "Notification Method",
      type: "text"
    },
    {
      key: "notificationTarget",
      label: "Notification Target",
      type: "text"
    },
    {
      key: "logLocation",
      label: "Log Location",
      type: "text"
    },
    {
      key: "logRetentionDays",
      label: "Log Retention Days",
      type: "number"
    },
    {
      key: "firstResponseAt",
      label: "First Response At",
      type: "datetime-local"
    }
  ],
  "Backup / Recovery Test": [
    {
      key: "backupResult",
      label: "Backup Result",
      type: "select",
      options: ["", "Passed", "Failed"]
    },
    {
      key: "recoveryResult",
      label: "Recovery Result",
      type: "select",
      options: ["", "Passed", "Failed"]
    },
    {
      key: "backupLocation",
      label: "Backup Location",
      type: "text"
    },
    {
      key: "recoveryEvidence",
      label: "Recovery Evidence",
      type: "textarea"
    }
  ]
};

export function getIssueType(value: string): IssueTypeName {
  return ISSUE_TYPES.includes(value as IssueTypeName) ? (value as IssueTypeName) : "Hotfix";
}

export function getWorkflow(issueType: string): string[] {
  return WORKFLOWS[getIssueType(issueType)];
}

export function getInitialStatus(issueType: string): string {
  return getWorkflow(issueType)[0];
}

export function getStatusIndex(issueType: string, workflowStatus: string): number {
  return getWorkflow(issueType).indexOf(workflowStatus);
}

export function isAtOrPastStatus(issueType: string, workflowStatus: string, checkpoint: string): boolean {
  const workflow = getWorkflow(issueType);
  const currentIndex = workflow.indexOf(workflowStatus);
  const checkpointIndex = workflow.indexOf(checkpoint);

  return currentIndex >= 0 && checkpointIndex >= 0 && currentIndex >= checkpointIndex;
}

export function getPreviousStatus(issueType: string, workflowStatus: string): string | null {
  const workflow = getWorkflow(issueType);
  const index = workflow.indexOf(workflowStatus);

  return index > 0 ? workflow[index - 1] : null;
}

export function getNextStatus(issueType: string, workflowStatus: string): string | null {
  const workflow = getWorkflow(issueType);
  const index = workflow.indexOf(workflowStatus);

  return index >= 0 && index < workflow.length - 1 ? workflow[index + 1] : null;
}

export function isClosePreparationStage(issueType: string, workflowStatus: string): boolean {
  const workflow = getWorkflow(issueType);
  const index = workflow.indexOf(workflowStatus);

  return index >= 0 && index === workflow.length - 2;
}

export function statusLightClasses(statusLight: string): string {
  switch (statusLight) {
    case "Red":
      return "border-[#f1aeb5] bg-[#f8d7da] text-[#842029]";
    case "Yellow":
      return "border-[#ffda6a] bg-[#fff3cd] text-[#664d03]";
    case "Blue":
      return "border-[#9ec5fe] bg-[#cfe2ff] text-[#084298]";
    case "Green":
      return "border-[#a3cfbb] bg-[#d1e7dd] text-[#0f5132]";
    case "Gray":
      return "border-[#c6c7c8] bg-[#e2e3e5] text-[#41464b]";
    default:
      return "border-slate-200 bg-white text-slate-600";
  }
}

export function statusLightDotClasses(statusLight: string): string {
  switch (statusLight) {
    case "Red":
      return "bg-[#dc3545]";
    case "Yellow":
      return "bg-[#ffc107]";
    case "Blue":
      return "bg-[#0d6efd]";
    case "Green":
      return "bg-[#198754]";
    case "Gray":
      return "bg-[#6c757d]";
    default:
      return "bg-slate-300";
  }
}
