import { PrismaClient } from "@prisma/client";
import { DYNAMIC_FIELDS, ISSUE_TYPES, WORKFLOWS, getIssueType } from "../lib/governance";
import { displayIssueType } from "../lib/i18n";
import { deriveIssueState } from "../lib/rules";

const prisma = new PrismaClient();

type SeedIssue = {
  issueKey: string;
  issueType: string;
  title: string;
  description: string;
  systemName: string;
  environment: string;
  riskLevel: string;
  priority: string;
  ownerRole: string;
  ownerName: string;
  reporter: string;
  workflowStatus: string;
  dueOffsetDays: number;
  needRca?: boolean;
  needRiskException?: boolean;
  impactProduction?: boolean;
  waitingRole?: string | null;
  fields?: Record<string, string>;
  comments?: Array<{ authorRole: string; authorName: string; body: string }>;
  evidence?: Array<{ type: string; title: string; url: string; description?: string }>;
};

function dateOffset(days: number) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  value.setHours(18, 0, 0, 0);
  return value;
}

function fieldLabel(issueType: string, key: string) {
  return DYNAMIC_FIELDS[getIssueType(issueType)].find((field) => field.key === key)?.label ?? key;
}

async function resetDatabase() {
  await prisma.aiSuggestion.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.evidence.deleteMany();
  await prisma.issueFieldValue.deleteMany();
  await prisma.issue.deleteMany();
  await prisma.workflowStatus.deleteMany();
  await prisma.issueType.deleteMany();
}

async function seedReferenceData() {
  for (const issueType of ISSUE_TYPES) {
    const createdType = await prisma.issueType.create({
      data: {
        name: issueType,
        description: `${displayIssueType(issueType)} 治理流程`
      }
    });

    await prisma.workflowStatus.createMany({
      data: WORKFLOWS[issueType].map((status, index) => ({
        issueTypeId: createdType.id,
        name: status,
        sortOrder: index + 1
      }))
    });
  }
}

async function createIssue(seed: SeedIssue) {
  const issue = await prisma.issue.create({
    data: {
      issueKey: seed.issueKey,
      issueType: seed.issueType,
      title: seed.title,
      description: seed.description,
      systemName: seed.systemName,
      environment: seed.environment,
      riskLevel: seed.riskLevel,
      priority: seed.priority,
      ownerRole: seed.ownerRole,
      ownerName: seed.ownerName,
      reporter: seed.reporter,
      workflowStatus: seed.workflowStatus,
      statusLight: "Yellow",
      dueDate: dateOffset(seed.dueOffsetDays),
      needRca: seed.needRca ?? false,
      needRiskException: seed.needRiskException ?? false,
      impactProduction: seed.impactProduction ?? false,
      evidenceStatus: "Missing",
      waitingRole: seed.waitingRole ?? null,
      closedAt: seed.workflowStatus === "Closed" ? new Date() : null,
      fieldValues: {
        create: Object.entries(seed.fields ?? {}).map(([fieldKey, fieldValue]) => ({
          fieldKey,
          fieldLabel: fieldLabel(seed.issueType, fieldKey),
          fieldValue
        }))
      },
      comments: {
        create: seed.comments ?? []
      },
      evidence: {
        create: seed.evidence ?? []
      },
      auditLogs: {
        create: {
          actionType: "Seed Created",
          actionSummary: `${seed.issueKey} 已由種子資料建立。`,
          actorRole: "Admin",
          actorName: "Seed Script"
        }
      }
    },
    include: {
      fieldValues: true,
      evidence: true,
      comments: true
    }
  });

  const fullIssue = await prisma.issue.findUniqueOrThrow({
    where: { id: issue.id },
    include: {
      fieldValues: true,
      evidence: true,
      comments: true
    }
  });
  const derived = deriveIssueState(fullIssue);

  await prisma.issue.update({
    where: { id: issue.id },
    data: derived
  });
}

async function main() {
  await resetDatabase();
  await seedReferenceData();

  const seeds: SeedIssue[] = [
    {
      issueKey: "DMS-1001",
      issueType: "Hotfix",
      title: "Payment callback hotfix failed QA regression",
      description: "Payment callback hotfix cannot move to release because QA regression failed.",
      systemName: "Payment Gateway",
      environment: "Production",
      riskLevel: "High",
      priority: "P1",
      ownerRole: "RD",
      ownerName: "Alex Chen",
      reporter: "Mia Lin",
      workflowStatus: "OP Releasing",
      dueOffsetDays: 1,
      fields: {
        impactScope: "Production callback endpoint for credit-card confirmation.",
        rdFixSummary: "Adjusted callback idempotency key handling.",
        rdSelfTestResult: "Unit and local integration tests completed.",
        qaResult: "Failed"
      }
    },
    {
      issueKey: "DMS-1002",
      issueType: "Hotfix",
      title: "Order retry queue patch awaiting QA validation",
      description: "Retry queue behavior was corrected and is ready for QA confirmation.",
      systemName: "Order Service",
      environment: "Staging",
      riskLevel: "Medium",
      priority: "P2",
      ownerRole: "QA",
      ownerName: "Nina Huang",
      reporter: "Alex Chen",
      workflowStatus: "QA Verifying",
      dueOffsetDays: 2,
      waitingRole: "QA",
      fields: {
        impactScope: "Order retry jobs and delayed payment capture reconciliation.",
        rdFixSummary: "Limited retry worker concurrency and added duplicate guard.",
        rdSelfTestResult: "RD self-test passed with 500 replayed retry jobs."
      }
    },
    {
      issueKey: "DMS-1003",
      issueType: "Hotfix",
      title: "Session timeout emergency fix closed",
      description: "Emergency timeout configuration has been deployed and verified.",
      systemName: "Identity Portal",
      environment: "Production",
      riskLevel: "Low",
      priority: "P3",
      ownerRole: "OP",
      ownerName: "Kai Wu",
      reporter: "Mia Lin",
      workflowStatus: "Closed",
      dueOffsetDays: -3,
      fields: {
        impactScope: "Internal identity portal login sessions.",
        rdFixSummary: "Updated timeout configuration and cache invalidation.",
        rdSelfTestResult: "Self-test passed on staging and production canary.",
        qaResult: "Passed",
        productionConfirmationResult: "Production session behavior verified."
      },
      evidence: [
        {
          type: "Deployment",
          title: "Deployment record",
          url: "https://example.com/evidence/DMS-1003-deployment",
          description: "Deployment and rollback record."
        }
      ],
      comments: [
        {
          authorRole: "DMS Manager",
          authorName: "Grace Tsai",
          body: "Closure comment: evidence reviewed and issue closed."
        }
      ]
    },
    {
      issueKey: "DMS-1004",
      issueType: "Incident",
      title: "High incident missing RCA decision",
      description: "High severity incident needs RCA flag before continuing governance tracking.",
      systemName: "Settlement Service",
      environment: "Production",
      riskLevel: "High",
      priority: "P1",
      ownerRole: "PM",
      ownerName: "Ivy Hsu",
      reporter: "Ops Watch",
      workflowStatus: "Initial Handling",
      dueOffsetDays: 1,
      fields: {
        incidentLevel: "High",
        detectionTime: "2026-07-18T09:10",
        impactedServices: "Settlement batch and finance reconciliation."
      }
    },
    {
      issueKey: "DMS-1005",
      issueType: "Incident",
      title: "Medium production incident awaiting Security review",
      description: "Production-impact incident has RCA requirement set and waits for Security assessment.",
      systemName: "Customer API",
      environment: "Production",
      riskLevel: "Medium",
      priority: "P2",
      ownerRole: "Security",
      ownerName: "Evan Liu",
      reporter: "Service Desk",
      workflowStatus: "RCA Decision",
      dueOffsetDays: 3,
      needRca: true,
      impactProduction: true,
      waitingRole: "Security",
      fields: {
        incidentLevel: "Medium",
        detectionTime: "2026-07-17T20:45",
        impactedServices: "External customer API latency.",
        initialHandlingResult: "Traffic was shifted and rate limits were tuned."
      }
    },
    {
      issueKey: "DMS-1006",
      issueType: "Incident",
      title: "DR connectivity interruption closed",
      description: "Temporary DR link interruption was resolved and verified.",
      systemName: "DR Network",
      environment: "DR",
      riskLevel: "Low",
      priority: "P3",
      ownerRole: "OP",
      ownerName: "Kai Wu",
      reporter: "Ops Watch",
      workflowStatus: "Closed",
      dueOffsetDays: -2,
      needRca: false,
      fields: {
        incidentLevel: "Low",
        detectionTime: "2026-07-14T10:30",
        impactedServices: "DR monitoring channel only.",
        initialHandlingResult: "Carrier route was restored and verified."
      },
      evidence: [
        {
          type: "Monitoring",
          title: "DR link recovery screenshot",
          url: "https://example.com/evidence/DMS-1006-monitoring",
          description: "Network recovery proof."
        }
      ],
      comments: [
        {
          authorRole: "OP",
          authorName: "Kai Wu",
          body: "Closure comment: service stable for 24 hours."
        }
      ]
    },
    {
      issueKey: "DMS-1007",
      issueType: "RCA",
      title: "RCA opened for notification delivery delay",
      description: "Initial RCA record created after repeated notification delivery delay.",
      systemName: "Notification Hub",
      environment: "Production",
      riskLevel: "Medium",
      priority: "P2",
      ownerRole: "RD",
      ownerName: "Alex Chen",
      reporter: "Mia Lin",
      workflowStatus: "Created",
      dueOffsetDays: 5
    },
    {
      issueKey: "DMS-1008",
      issueType: "RCA",
      title: "RCA verification for report export timeout",
      description: "Corrective and preventive actions are ready for verification.",
      systemName: "Reporting Center",
      environment: "Production",
      riskLevel: "Medium",
      priority: "P2",
      ownerRole: "QA",
      ownerName: "Nina Huang",
      reporter: "Ivy Hsu",
      workflowStatus: "Verification",
      dueOffsetDays: 4,
      fields: {
        rootCauseSummary: "Large report export held database connection longer than expected.",
        correctiveAction: "Added stream export and query timeout guard.",
        preventiveAction: "Added load test case and dashboard alert.",
        verificationResult: "Verification in progress."
      },
      evidence: [
        {
          type: "Test",
          title: "Load test run",
          url: "https://example.com/evidence/DMS-1008-load-test",
          description: "Load test result for export path."
        }
      ]
    },
    {
      issueKey: "DMS-1009",
      issueType: "Risk Exception",
      title: "Temporary TLS exception awaiting DMS Manager approval",
      description: "Legacy partner endpoint needs a temporary risk exception.",
      systemName: "Partner Gateway",
      environment: "Production",
      riskLevel: "High",
      priority: "P1",
      ownerRole: "DMS Manager",
      ownerName: "Grace Tsai",
      reporter: "Evan Liu",
      workflowStatus: "Pending Approval",
      dueOffsetDays: 2,
      needRiskException: true,
      waitingRole: "DMS Manager",
      fields: {
        riskDescription: "Partner endpoint cannot complete TLS upgrade before contract cutover.",
        temporaryRiskReductionMeasure: "Restrict source IP and increase monitoring.",
        followUpPlan: "Partner upgrade deadline and weekly review.",
        approvalRole: "DMS Manager"
      }
    },
    {
      issueKey: "DMS-1010",
      issueType: "Risk Exception",
      title: "Read-only report export exception tracking",
      description: "Approved medium risk exception is being tracked to verification.",
      systemName: "Analytics Portal",
      environment: "Internal",
      riskLevel: "Medium",
      priority: "P3",
      ownerRole: "Security",
      ownerName: "Evan Liu",
      reporter: "Ivy Hsu",
      workflowStatus: "Approved",
      dueOffsetDays: 10,
      needRiskException: true,
      fields: {
        riskDescription: "Temporary report export access for audit preparation.",
        temporaryRiskReductionMeasure: "Read-only access, export watermark, and owner approval.",
        followUpPlan: "Remove access after audit evidence package is completed.",
        approvalRole: "Security"
      }
    },
    {
      issueKey: "DMS-1011",
      issueType: "QA Verification",
      title: "QA verification failed for release candidate 3.8.1",
      description: "Regression failure prevents release closure.",
      systemName: "Mobile Backend",
      environment: "UAT",
      riskLevel: "Medium",
      priority: "P2",
      ownerRole: "QA",
      ownerName: "Nina Huang",
      reporter: "Alex Chen",
      workflowStatus: "Release Decision",
      dueOffsetDays: 1,
      fields: {
        testItems: "Login, checkout, notification, profile update.",
        qaResult: "Failed",
        releaseDecisionNote: "Checkout regression failed on retry path."
      }
    },
    {
      issueKey: "DMS-1012",
      issueType: "QA Verification",
      title: "QA verification closed for admin export patch",
      description: "Verification passed and release decision was recorded.",
      systemName: "Admin Console",
      environment: "Production",
      riskLevel: "Low",
      priority: "P3",
      ownerRole: "QA",
      ownerName: "Nina Huang",
      reporter: "Ivy Hsu",
      workflowStatus: "Closed",
      dueOffsetDays: -1,
      fields: {
        testItems: "Export permission, audit log, and file checksum.",
        qaResult: "Passed",
        releaseDecisionNote: "Release approved."
      },
      evidence: [
        {
          type: "QA",
          title: "QA sign-off",
          url: "https://example.com/evidence/DMS-1012-qa",
          description: "QA sign-off record."
        }
      ],
      comments: [
        {
          authorRole: "QA",
          authorName: "Nina Huang",
          body: "Closure comment: QA evidence complete."
        }
      ]
    },
    {
      issueKey: "DMS-1013",
      issueType: "Change / Release",
      title: "Release blocked because rollback plan is missing",
      description: "Release cannot continue without rollback plan evidence.",
      systemName: "Billing Service",
      environment: "Production",
      riskLevel: "High",
      priority: "P1",
      ownerRole: "OP",
      ownerName: "Kai Wu",
      reporter: "Ivy Hsu",
      workflowStatus: "Releasing",
      dueOffsetDays: 1,
      fields: {
        releaseVersion: "2026.07.18.1",
        rollbackPlan: ""
      }
    },
    {
      issueKey: "DMS-1014",
      issueType: "Change / Release",
      title: "Search service release in production confirmation",
      description: "Release is deployed and waiting for production health confirmation.",
      systemName: "Search Service",
      environment: "Production",
      riskLevel: "Medium",
      priority: "P2",
      ownerRole: "OP",
      ownerName: "Kai Wu",
      reporter: "Alex Chen",
      workflowStatus: "Production Confirmation",
      dueOffsetDays: 2,
      fields: {
        releaseVersion: "2026.07.18.2",
        rollbackPlan: "Rollback to image search-service:2026.07.10 within 15 minutes.",
        productionConfirmationResult: ""
      }
    },
    {
      issueKey: "DMS-1015",
      issueType: "Monitoring Inventory",
      title: "Critical alert has no first response after 30 minutes",
      description: "Critical inventory alert is unanswered beyond the response target.",
      systemName: "Fraud Monitor",
      environment: "Production",
      riskLevel: "Critical",
      priority: "P1",
      ownerRole: "OP",
      ownerName: "Kai Wu",
      reporter: "Ops Watch",
      workflowStatus: "Active",
      dueOffsetDays: 1,
      fields: {
        componentName: "Risk signal worker",
        monitoringItems: "Critical error rate and queue age.",
        alertLevel: "Critical",
        alertCondition: "Queue age > 30 minutes or error rate > 5%.",
        notificationMethod: "Teams + SMS",
        notificationTarget: "OP on-call",
        logLocation: "SIEM fraud-monitor index",
        logRetentionDays: "180",
        firstResponseAt: ""
      }
    },
    {
      issueKey: "DMS-1016",
      issueType: "Monitoring Inventory",
      title: "Monitoring log retention below governance requirement",
      description: "Inventory review found log retention configured for only 30 days.",
      systemName: "Legacy Batch",
      environment: "Production",
      riskLevel: "Medium",
      priority: "P2",
      ownerRole: "Security",
      ownerName: "Evan Liu",
      reporter: "Ops Watch",
      workflowStatus: "Need Update",
      dueOffsetDays: 6,
      fields: {
        componentName: "Nightly reconciliation batch",
        monitoringItems: "Job result and SLA miss count.",
        alertLevel: "Warning",
        alertCondition: "SLA miss count > 0.",
        notificationMethod: "Email",
        notificationTarget: "Batch owner group",
        logLocation: "Central logging legacy-batch",
        logRetentionDays: "30",
        firstResponseAt: "2026-07-18T08:40"
      }
    },
    {
      issueKey: "DMS-1017",
      issueType: "Monitoring Inventory",
      title: "Core API monitoring inventory active",
      description: "Monitoring inventory is current and active.",
      systemName: "Core API",
      environment: "Production",
      riskLevel: "Low",
      priority: "P4",
      ownerRole: "OP",
      ownerName: "Kai Wu",
      reporter: "Ops Watch",
      workflowStatus: "Active",
      dueOffsetDays: 30,
      fields: {
        componentName: "Core API ingress",
        monitoringItems: "Latency, 5xx rate, saturation, and dependency errors.",
        alertLevel: "Normal",
        alertCondition: "5xx rate > 2% for 5 minutes.",
        notificationMethod: "Teams",
        notificationTarget: "Core API owners",
        logLocation: "Central logging core-api",
        logRetentionDays: "365",
        firstResponseAt: "2026-07-18T09:00"
      },
      evidence: [
        {
          type: "Inventory",
          title: "Monitoring inventory review",
          url: "https://example.com/evidence/DMS-1017-inventory",
          description: "Current monitoring inventory review."
        }
      ]
    },
    {
      issueKey: "DMS-1018",
      issueType: "Backup / Recovery Test",
      title: "Backup result failed for document archive",
      description: "Backup validation failed and recovery readiness must be reviewed.",
      systemName: "Document Archive",
      environment: "DR",
      riskLevel: "High",
      priority: "P1",
      ownerRole: "OP",
      ownerName: "Kai Wu",
      reporter: "DMS Scheduler",
      workflowStatus: "Verification",
      dueOffsetDays: 1,
      fields: {
        backupResult: "Failed",
        recoveryResult: "",
        backupLocation: "DR object storage archive-backup",
        recoveryEvidence: ""
      }
    },
    {
      issueKey: "DMS-1019",
      issueType: "Backup / Recovery Test",
      title: "Quarterly recovery test closed",
      description: "Backup and recovery test completed successfully.",
      systemName: "Customer Ledger",
      environment: "DR",
      riskLevel: "Low",
      priority: "P3",
      ownerRole: "OP",
      ownerName: "Kai Wu",
      reporter: "DMS Scheduler",
      workflowStatus: "Closed",
      dueOffsetDays: -5,
      fields: {
        backupResult: "Passed",
        recoveryResult: "Passed",
        backupLocation: "DR object storage ledger-backup",
        recoveryEvidence: "Recovery completed in 42 minutes."
      },
      evidence: [
        {
          type: "Recovery Test",
          title: "Recovery test record",
          url: "https://example.com/evidence/DMS-1019-recovery",
          description: "Signed recovery test report."
        }
      ],
      comments: [
        {
          authorRole: "DMS Manager",
          authorName: "Grace Tsai",
          body: "Closure comment: quarterly recovery test accepted."
        }
      ]
    }
  ];

  for (const seed of seeds) {
    await createIssue(seed);
  }

  console.log(`Seeded ${seeds.length} issues.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
