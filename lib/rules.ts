import {
  getNextStatus,
  isAtOrPastStatus,
  isClosePreparationStage
} from "@/lib/governance";
import type { GateResult, IssueWithRelations } from "@/lib/types";
import { fieldMap, isFilled } from "@/lib/utils";

function addMissingField(result: GateResult, label: string) {
  if (!result.missingFields.includes(label)) {
    result.missingFields.push(label);
  }
}

function addBlockReason(result: GateResult, reason: string) {
  if (!result.blockReasons.includes(reason)) {
    result.blockReasons.push(reason);
  }
}

function hasClosureComment(issue: Pick<IssueWithRelations, "comments">): boolean {
  return issue.comments.some((comment) => {
    const body = comment.body.toLowerCase();
    return body.includes("closure") || body.includes("closed") || body.includes("結案");
  });
}

export function isCriticalMonitoringUnanswered(issue: IssueWithRelations): boolean {
  const values = fieldMap(issue.fieldValues);

  return (
    issue.issueType === "Monitoring Inventory" &&
    values.alertLevel === "Critical" &&
    !isFilled(values.firstResponseAt)
  );
}

export function evaluateGateRules(
  issue: IssueWithRelations,
  targetStatus = issue.workflowStatus
): GateResult {
  const values = fieldMap(issue.fieldValues);
  const result: GateResult = {
    passed: true,
    missingFields: [],
    missingEvidence: [],
    blockReasons: [],
    nextStep: ""
  };

  const atOrPast = (checkpoint: string) =>
    isAtOrPastStatus(issue.issueType, targetStatus, checkpoint);

  if (issue.issueType === "Hotfix") {
    if (atOrPast("RD Fixing") && !isFilled(values.impactScope)) {
      addMissingField(result, "Impact Scope");
    }

    if (atOrPast("QA Verifying")) {
      if (!isFilled(values.rdFixSummary)) {
        addMissingField(result, "RD Fix Summary");
      }

      if (!isFilled(values.rdSelfTestResult)) {
        addMissingField(result, "RD Self-Test Result");
      }
    }

    if (atOrPast("OP Releasing")) {
      if (!isFilled(values.qaResult)) {
        addMissingField(result, "QA Result");
      } else if (values.qaResult === "Failed") {
        addBlockReason(result, "QA Result is Failed, so OP Releasing is blocked.");
      } else if (!["Passed", "Conditional Passed"].includes(values.qaResult)) {
        addBlockReason(result, "QA Result must be Passed or Conditional Passed.");
      }
    }

    if (values.qaResult === "Conditional Passed" && !issue.needRiskException) {
      addBlockReason(result, "Conditional Passed requires Need Risk Exception.");
    }
  }

  if (issue.issueType === "Incident") {
    if (atOrPast("Initial Handling") && !isFilled(values.incidentLevel)) {
      addMissingField(result, "Incident Level");
    }

    if (values.incidentLevel === "High" && !issue.needRca) {
      addBlockReason(result, "High incident requires Need RCA.");
    }

    if (values.incidentLevel === "Medium" && issue.impactProduction && !issue.needRca) {
      addBlockReason(result, "Medium production-impact incident requires Need RCA.");
    }

    if (targetStatus === "Closed" && !isFilled(values.initialHandlingResult)) {
      addMissingField(result, "Initial Handling Result");
    }
  }

  if (issue.issueType === "RCA") {
    if (atOrPast("Corrective Action") && !isFilled(values.rootCauseSummary)) {
      addMissingField(result, "Root Cause Summary");
    }

    if (atOrPast("Verification")) {
      if (!isFilled(values.correctiveAction)) {
        addMissingField(result, "Corrective Action");
      }

      if (!isFilled(values.preventiveAction)) {
        addMissingField(result, "Preventive Action");
      }
    }

    if (targetStatus === "Closed" && !isFilled(values.verificationResult)) {
      addMissingField(result, "Verification Result");
    }
  }

  if (issue.issueType === "Risk Exception") {
    if (atOrPast("Pending Approval")) {
      if (!isFilled(values.riskDescription)) {
        addMissingField(result, "Risk Description");
      }

      if (!isFilled(values.temporaryRiskReductionMeasure)) {
        addMissingField(result, "Temporary Risk Reduction Measure");
      }

      if (!isFilled(values.followUpPlan)) {
        addMissingField(result, "Follow-up Plan");
      }
    }

    if (issue.riskLevel === "High" && values.approvalRole !== "DMS Manager") {
      addBlockReason(result, "High risk exception requires DMS Manager approval role.");
    }

    if (targetStatus === "Closed" && !isFilled(values.verificationResult)) {
      addMissingField(result, "Verification Result");
    }
  }

  if (issue.issueType === "QA Verification") {
    if (atOrPast("Release Decision")) {
      if (!isFilled(values.testItems)) {
        addMissingField(result, "Test Items");
      }

      if (!isFilled(values.qaResult)) {
        addMissingField(result, "QA Result");
      }
    }

    if (targetStatus === "Closed" && values.qaResult === "Failed") {
      addBlockReason(result, "Failed QA Result cannot be closed.");
    }
  }

  if (issue.issueType === "Change / Release") {
    if (atOrPast("Releasing")) {
      if (!isFilled(values.releaseVersion)) {
        addMissingField(result, "Release Version");
      }

      if (!isFilled(values.rollbackPlan)) {
        addMissingField(result, "Rollback Plan");
      }
    }

    if (targetStatus === "Closed" && !isFilled(values.productionConfirmationResult)) {
      addMissingField(result, "Production Confirmation Result");
    }
  }

  if (issue.issueType === "Backup / Recovery Test") {
    if (atOrPast("Verification") && !isFilled(values.backupResult)) {
      addMissingField(result, "Backup Result");
    }

    if (values.backupResult === "Failed") {
      addBlockReason(result, "Backup Result is Failed, so status light must remain Red.");
    }

    if (
      values.recoveryResult === "Failed" &&
      !issue.needRca &&
      !issue.needRiskException
    ) {
      addBlockReason(
        result,
        "Recovery Result is Failed; mark Need RCA or Need Risk Exception."
      );
    }
  }

  if (targetStatus === "Closed" && issue.evidence.length === 0 && !hasClosureComment(issue)) {
    result.missingEvidence.push("At least one Evidence link or Closure Comment");
  }

  result.passed =
    result.missingFields.length === 0 &&
    result.missingEvidence.length === 0 &&
    result.blockReasons.length === 0;

  result.nextStep = result.passed
    ? getNextStatus(issue.issueType, targetStatus)
      ? `Ready for ${getNextStatus(issue.issueType, targetStatus)}.`
      : "Workflow is complete."
    : "Resolve gate findings before moving forward.";

  return result;
}

export function calculateStatusLight(issue: IssueWithRelations): "Red" | "Yellow" | "Blue" | "Green" | "Gray" {
  if (issue.workflowStatus === "Closed") {
    return "Gray";
  }

  const values = fieldMap(issue.fieldValues);

  if (new Date(issue.dueDate).getTime() < Date.now()) {
    return "Red";
  }

  if (values.qaResult === "Failed") {
    return "Red";
  }

  if (isCriticalMonitoringUnanswered(issue)) {
    return "Red";
  }

  const gate = evaluateGateRules(issue);
  if (!gate.passed) {
    return "Red";
  }

  if (isClosePreparationStage(issue.issueType, issue.workflowStatus) && issue.evidence.length === 0) {
    return "Yellow";
  }

  if (isFilled(issue.waitingRole)) {
    return "Blue";
  }

  const pendingStatuses = [
    "Submitted",
    "Reported",
    "Created",
    "Draft",
    "Planned",
    "Hotfix Review",
    "Initial Assessment",
    "Risk Review",
    "Release Review",
    "Reviewing",
    "Need Update",
    "Retesting"
  ];

  if (pendingStatuses.includes(issue.workflowStatus)) {
    return "Yellow";
  }

  return "Green";
}

export function deriveIssueState(issue: IssueWithRelations) {
  const gate = evaluateGateRules(issue);
  const evidenceStatus = issue.evidence.length > 0 ? "Complete" : "Missing";
  const statusLight = calculateStatusLight(issue);
  const blockReason = gate.passed
    ? null
    : [...gate.missingFields, ...gate.missingEvidence, ...gate.blockReasons].join("; ");

  return {
    statusLight,
    evidenceStatus,
    blockReason,
    nextStep: gate.nextStep
  };
}
