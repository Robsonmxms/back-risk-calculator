import { randomUUID } from "crypto";
import type { User } from "../../src/01-domain/users/user";
import type { PasswordHasher } from "../../src/02-application/ports/security";
import { ScryptPasswordHasher } from "../../src/03-adapters/security/ScryptPasswordHasher";
import { InMemoryIdentityStore } from "../../src/04-infra/repositories/InMemoryIdentityStore";

export async function createSeededIdentityStore(
  passwordHasher: PasswordHasher = new ScryptPasswordHasher()
): Promise<InMemoryIdentityStore> {
  const store = new InMemoryIdentityStore();
  const now = new Date("2026-07-09T00:00:00.000Z");
  const passwordHash = await passwordHasher.hash("Password123!");

  const users: User[] = [
    {
      id: "usr_admin",
      email: "admin@risk.local",
      name: "Administrador",
      role: "admin",
      status: "active",
      passwordHash,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "usr_analyst",
      email: "analyst@risk.local",
      name: "Analista",
      role: "analyst",
      status: "active",
      passwordHash,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "usr_advisor",
      email: "advisor@example.com",
      name: "Assessor",
      role: "user",
      status: "active",
      passwordHash,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "usr_assistant",
      email: "assistant@example.com",
      name: "Assistente",
      role: "user",
      status: "active",
      passwordHash,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "usr_client",
      email: "client@example.com",
      name: "Cliente",
      role: "user",
      status: "active",
      passwordHash,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "usr_user",
      email: "user@risk.local",
      name: "Usuário do Portfólio",
      role: "user",
      status: "active",
      passwordHash,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "usr_other",
      email: "other@risk.local",
      name: "Usuário Secundário",
      role: "user",
      status: "active",
      passwordHash,
      createdAt: now,
      updatedAt: now
    }
  ];

  for (const user of users) {
    store.users.set(user.id, user);
  }

  store.offices.set("ofc_main", {
    id: "ofc_main",
    name: "Orion Advisory",
    status: "active",
    createdAt: now,
    updatedAt: now
  });
  store.offices.set("ofc_private", {
    id: "ofc_private",
    name: "Private Allocation Desk",
    status: "active",
    createdAt: now,
    updatedAt: now
  });

  store.officeMembers.set("ofm_admin_main", {
    id: "ofm_admin_main",
    officeId: "ofc_main",
    userId: "usr_admin",
    role: "office_admin",
    createdAt: now
  });
  store.officeMembers.set("ofm_user_main", {
    id: "ofm_user_main",
    officeId: "ofc_main",
    userId: "usr_user",
    role: "office_admin",
    createdAt: now
  });
  store.officeMembers.set("ofm_advisor_main", {
    id: "ofm_advisor_main",
    officeId: "ofc_main",
    userId: "usr_advisor",
    role: "advisor",
    createdAt: now
  });
  store.officeMembers.set("ofm_analyst_main", {
    id: "ofm_analyst_main",
    officeId: "ofc_main",
    userId: "usr_analyst",
    role: "analyst",
    createdAt: now
  });
  store.officeMembers.set("ofm_assistant_main", {
    id: "ofm_assistant_main",
    officeId: "ofc_main",
    userId: "usr_assistant",
    role: "assistant",
    createdAt: now
  });
  store.officeMembers.set("ofm_client_main", {
    id: "ofm_client_main",
    officeId: "ofc_main",
    userId: "usr_client",
    role: "client",
    createdAt: now
  });
  store.officeMembers.set("ofm_analyst_private", {
    id: "ofm_analyst_private",
    officeId: "ofc_private",
    userId: "usr_analyst",
    role: "analyst",
    createdAt: now
  });
  store.officeMembers.set("ofm_other_private", {
    id: "ofm_other_private",
    officeId: "ofc_private",
    userId: "usr_other",
    role: "office_admin",
    createdAt: now
  });

  store.advisoryTeams.set("team_core_main", {
    id: "team_core_main",
    officeId: "ofc_main",
    name: "Core Advisory Team",
    description: "Advisor, analyst, and assistant coverage for priority clients.",
    status: "active",
    createdAt: now,
    updatedAt: now
  });
  for (const [id, userId] of [
    ["tm_advisor_main", "usr_advisor"],
    ["tm_analyst_main", "usr_analyst"],
    ["tm_assistant_main", "usr_assistant"]
  ]) {
    const membership = Array.from(store.officeMembers.values()).find(
      (entry) => entry.officeId === "ofc_main" && entry.userId === userId
    );
    if (membership) {
      store.advisoryTeamMembers.set(id, {
        id,
        officeId: "ofc_main",
        teamId: "team_core_main",
        userId,
        role: membership.role,
        createdAt: now
      });
    }
  }
  store.advisoryAssignments.set("asn_core_client_main", {
    id: "asn_core_client_main",
    officeId: "ofc_main",
    resourceType: "client",
    resourceId: "client_main",
    teamId: "team_core_main",
    permissions: ["client.read", "ledger.read", "analytics.read", "reports.request"],
    createdBy: "usr_user",
    createdAt: now
  });
  store.advisoryAssignments.set("asn_client_viewer_main", {
    id: "asn_client_viewer_main",
    officeId: "ofc_main",
    resourceType: "client",
    resourceId: "client_main",
    assigneeUserId: "usr_client",
    permissions: ["client.read", "reports.request", "notifications.read"],
    createdBy: "usr_user",
    createdAt: now
  });

  store.households.set("hh_main_silva", {
    id: "hh_main_silva",
    officeId: "ofc_main",
    name: "Família Silva",
    status: "active",
    createdAt: now,
    updatedAt: now
  });
  store.households.set("hh_main_founders", {
    id: "hh_main_founders",
    officeId: "ofc_main",
    name: "Grupo Founders",
    status: "active",
    createdAt: now,
    updatedAt: now
  });
  store.households.set("hh_private_allocation", {
    id: "hh_private_allocation",
    officeId: "ofc_private",
    name: "Grupo de Alocação Reservada",
    status: "active",
    createdAt: now,
    updatedAt: now
  });

  store.clients.set("client_main", {
    id: "client_main",
    officeId: "ofc_main",
    householdId: "hh_main_silva",
    name: "Marina Silva",
    email: "marina.silva@example.com",
    phone: "+55 11 99999-0101",
    documentLabel: "CPF final 0123",
    status: "active",
    onboardingStatus: "complete",
    advisorUserId: "usr_advisor",
    riskProfileDescriptor: "Perfil balanceado de crescimento",
    notes: "Prefere relatórios mensais de risco.",
    createdAt: now,
    updatedAt: now
  });
  store.clients.set("client_spouse", {
    id: "client_spouse",
    officeId: "ofc_main",
    householdId: "hh_main_silva",
    name: "Renato Silva",
    email: "renato.silva@example.com",
    phone: "+55 11 99999-0102",
    documentLabel: "CPF final 0456",
    status: "active",
    onboardingStatus: "onboarding",
    advisorUserId: "usr_advisor",
    riskProfileDescriptor: "Perfil orientado a renda",
    createdAt: now,
    updatedAt: now
  });
  store.clients.set("client_founder", {
    id: "client_founder",
    officeId: "ofc_main",
    householdId: "hh_main_founders",
    name: "Alice Founder",
    email: "alice.founder@example.com",
    documentLabel: "Passaporte final 7788",
    status: "inactive",
    onboardingStatus: "paused",
    advisorUserId: "usr_advisor",
    riskProfileDescriptor: "Exposição concentrada em ações",
    createdAt: now,
    updatedAt: now
  });
  store.clients.set("client_private", {
    id: "client_private",
    officeId: "ofc_private",
    householdId: "hh_private_allocation",
    name: "Cliente Reservado",
    email: "private.client@example.com",
    documentLabel: "CPF final 9999",
    status: "active",
    onboardingStatus: "complete",
    advisorUserId: "usr_other",
    riskProfileDescriptor: "Perfil de preservação de capital",
    createdAt: now,
    updatedAt: now
  });

  store.reviewItems.set("rev_main_report", {
    id: "rev_main_report",
    officeId: "ofc_main",
    title: "Revisar pacote mensal de risco antes da reunião com o cliente",
    severity: "medium",
    status: "open",
    resourceType: "client",
    resourceId: "client_main",
    clientId: "client_main",
    assignedToUserId: "usr_advisor",
    dueDate: "2026-07-20",
    notes: "Confirmar se os avisos de dados defasados estão claros antes da entrega.",
    createdBy: "usr_user",
    createdAt: now,
    updatedAt: now
  });
  store.reviewItems.set("rev_income_data", {
    id: "rev_income_data",
    officeId: "ofc_private",
    title: "Investigate delayed fixed-income market data",
    severity: "high",
    status: "open",
    resourceType: "portfolio",
    resourceId: "prt_income",
    clientId: "client_private",
    portfolioId: "prt_income",
    assignedToUserId: "usr_analyst",
    dueDate: "2026-07-18",
    notes: "Market data remains partial for one source.",
    createdBy: "usr_other",
    createdAt: now,
    updatedAt: now
  });

  store.auditEvents.set("aud_client_created", {
    id: "aud_client_created",
    officeId: "ofc_main",
    actorId: "usr_user",
    actorName: "Usuário do Portfólio",
    action: "client.created",
    resourceType: "client",
    resourceId: "client_main",
    clientId: "client_main",
    outcome: "success",
    severity: "info",
    reviewRequired: false,
    metadata: {
      onboardingStatus: "complete",
      householdId: "hh_main_silva"
    },
    createdAt: new Date("2026-07-09T10:00:00.000Z")
  });
  store.auditEvents.set("aud_permission_assignment", {
    id: "aud_permission_assignment",
    officeId: "ofc_main",
    actorId: "usr_user",
    actorName: "Usuário do Portfólio",
    action: "permission.assignment.created",
    resourceType: "permission",
    resourceId: "asn_core_client_main",
    clientId: "client_main",
    outcome: "success",
    severity: "warning",
    reviewRequired: true,
    metadata: {
      resourceType: "client",
      resourceId: "client_main",
      permissionCount: 4
    },
    createdAt: new Date("2026-07-09T10:10:00.000Z")
  });
  store.auditEvents.set("aud_ledger_transaction", {
    id: "aud_ledger_transaction",
    officeId: "ofc_main",
    actorId: "usr_advisor",
    actorName: "Assessor",
    action: "ledger.transaction.recorded",
    resourceType: "ledger",
    resourceId: "pltxn_001",
    clientId: "client_main",
    portfolioId: "prt_main",
    outcome: "success",
    severity: "info",
    reviewRequired: false,
    metadata: {
      assetSymbol: "MSFT",
      transactionType: "buy"
    },
    createdAt: new Date("2026-07-12T12:00:00.000Z")
  });
  store.auditEvents.set("aud_report_delivery_failed", {
    id: "aud_report_delivery_failed",
    officeId: "ofc_main",
    actorId: "usr_advisor",
    actorName: "Assessor",
    action: "delivery.report.failed",
    resourceType: "delivery",
    resourceId: "rpt_001",
    clientId: "client_main",
    portfolioId: "prt_main",
    outcome: "failure",
    severity: "critical",
    reviewRequired: true,
    metadata: {
      failureCode: "delivery_timeout",
      channel: "portal"
    },
    createdAt: new Date("2026-07-15T15:30:00.000Z")
  });
  store.auditEvents.set("aud_private_market_data", {
    id: "aud_private_market_data",
    officeId: "ofc_private",
    actorId: "usr_analyst",
    actorName: "Analista",
    action: "market_data.refresh.failed",
    resourceType: "market_data",
    resourceId: "prt_income",
    clientId: "client_private",
    portfolioId: "prt_income",
    outcome: "failure",
    severity: "warning",
    reviewRequired: true,
    metadata: {
      failureCode: "provider_delayed"
    },
    createdAt: new Date("2026-07-15T16:00:00.000Z")
  });
  store.supervisionReviews.set("sv_aud_permission_assignment", {
    id: "sv_aud_permission_assignment",
    officeId: "ofc_main",
    auditEventId: "aud_permission_assignment",
    status: "open",
    severity: "warning",
    createdAt: new Date("2026-07-09T10:10:00.000Z"),
    updatedAt: new Date("2026-07-09T10:10:00.000Z")
  });
  store.supervisionReviews.set("sv_aud_report_delivery_failed", {
    id: "sv_aud_report_delivery_failed",
    officeId: "ofc_main",
    auditEventId: "aud_report_delivery_failed",
    status: "open",
    severity: "critical",
    assignedToUserId: "usr_user",
    createdAt: new Date("2026-07-15T15:30:00.000Z"),
    updatedAt: new Date("2026-07-15T15:35:00.000Z")
  });
  store.supervisionReviews.set("sv_aud_private_market_data", {
    id: "sv_aud_private_market_data",
    officeId: "ofc_private",
    auditEventId: "aud_private_market_data",
    status: "open",
    severity: "warning",
    createdAt: new Date("2026-07-15T16:00:00.000Z"),
    updatedAt: new Date("2026-07-15T16:00:00.000Z")
  });
  store.reportPackages.set("rpkg_delivered_main", {
    id: "rpkg_delivered_main",
    officeId: "ofc_main",
    clientId: "client_main",
    householdId: "hh_main_silva",
    title: "Resumo de risco de julho",
    summaryNotes: "Resumo do portfólio preparado para o ciclo de revisão de julho.",
    internalNotes: "Confirmar a pauta da próxima reunião antes do acompanhamento.",
    status: "delivered",
    items: [
      {
        id: "rpkg_item_main_summary",
        type: "portfolio_summary",
        title: "Visão geral Core Growth",
        portfolioId: "prt_main",
        status: "ready"
      },
      {
        id: "rpkg_item_main_analytics",
        type: "analytics_snapshot",
        title: "Retrato das métricas de risco",
        portfolioId: "prt_main",
        analyticsSnapshotId: "analytics_prt_main_latest",
        format: "json",
        status: "ready"
      }
    ],
    createdBy: "usr_advisor",
    approvedBy: "usr_user",
    deliveredBy: "usr_user",
    createdAt: new Date("2026-07-14T10:00:00.000Z"),
    updatedAt: new Date("2026-07-15T11:00:00.000Z"),
    approvedAt: new Date("2026-07-15T10:00:00.000Z"),
    deliveredAt: new Date("2026-07-15T11:00:00.000Z")
  });
  store.reportPackages.set("rpkg_pending_main", {
    id: "rpkg_pending_main",
    officeId: "ofc_main",
    clientId: "client_main",
    householdId: "hh_main_silva",
    title: "Revisão de alocação pendente",
    summaryNotes: "Rascunho aguardando aprovação do escritório.",
    internalNotes: "Aguardando geração final do relatório.",
    status: "pending_approval",
    items: [
      {
        id: "rpkg_item_pending_report",
        type: "report",
        title: "Pacote mensal de risco",
        portfolioId: "prt_main",
        reportId: "rpt_001",
        format: "pdf",
        status: "pending"
      }
    ],
    createdBy: "usr_advisor",
    createdAt: new Date("2026-07-15T09:00:00.000Z"),
    updatedAt: new Date("2026-07-15T09:00:00.000Z")
  });
  store.reportPackages.set("rpkg_private_delivered", {
    id: "rpkg_private_delivered",
    officeId: "ofc_private",
    clientId: "client_private",
    householdId: "hh_private_allocation",
    title: "Atualização da carteira de renda reservada",
    summaryNotes: "Atualização somente leitura da carteira de renda.",
    status: "delivered",
    items: [
      {
        id: "rpkg_item_private_summary",
        type: "portfolio_summary",
        title: "Visão geral da carteira de renda",
        portfolioId: "prt_income",
        status: "ready"
      }
    ],
    createdBy: "usr_other",
    approvedBy: "usr_other",
    deliveredBy: "usr_other",
    createdAt: new Date("2026-07-15T08:00:00.000Z"),
    updatedAt: new Date("2026-07-15T12:00:00.000Z"),
    approvedAt: new Date("2026-07-15T11:00:00.000Z"),
    deliveredAt: new Date("2026-07-15T12:00:00.000Z")
  });
  store.auditEvents.set("aud_report_package_delivered", {
    id: "aud_report_package_delivered",
    officeId: "ofc_main",
    actorId: "usr_user",
    actorName: "Usuário do Portfólio",
    action: "report_package.delivered",
    resourceType: "delivery",
    resourceId: "rpkg_delivered_main",
    clientId: "client_main",
    portfolioId: "prt_main",
    outcome: "success",
    severity: "info",
    reviewRequired: false,
    metadata: {
      status: "delivered",
      itemCount: 2
    },
    createdAt: new Date("2026-07-15T11:00:00.000Z")
  });

  store.addAccount({
    id: "acct_main",
    officeId: "ofc_main",
    clientId: "client_main",
    householdId: "hh_main_silva",
    name: "Conta Principal de Portfólio",
    ownerUserId: "usr_user",
    createdAt: now,
    updatedAt: now
  });
  store.addAccount({
    id: "acct_private",
    officeId: "ofc_private",
    clientId: "client_private",
    householdId: "hh_private_allocation",
    name: "Conta Reservada",
    ownerUserId: "usr_other",
    createdAt: now,
    updatedAt: now
  });
  store.addAccount({
    id: "acct_income",
    officeId: "ofc_private",
    clientId: "client_private",
    householdId: "hh_private_allocation",
    name: "Carteira de Renda",
    ownerUserId: "usr_other",
    createdAt: now,
    updatedAt: now
  });

  store.addAccountMember({
    id: randomUUID(),
    accountId: "acct_main",
    userId: "usr_user",
    role: "owner",
    createdAt: now
  });
  store.addAccountMember({
    id: randomUUID(),
    accountId: "acct_main",
    userId: "usr_analyst",
    role: "analyst",
    createdAt: now
  });
  store.addAccountMember({
    id: randomUUID(),
    accountId: "acct_private",
    userId: "usr_other",
    role: "owner",
    createdAt: now
  });
  store.addAccountMember({
    id: randomUUID(),
    accountId: "acct_income",
    userId: "usr_analyst",
    role: "analyst",
    createdAt: now
  });

  store.addPortfolioSnapshot({
    accountId: "acct_main",
    officeId: "ofc_main",
    accountName: "Conta Principal de Portfólio",
    membershipRole: "owner",
    currency: "USD",
    marketValue: 245800,
    costBasis: 218100,
    unrealizedPnl: 27700,
    dayChangePercent: 1.4,
    holdingsCount: 4,
    openAlerts: 1,
    reportStatus: "ready",
    analytics: {
      riskScore: 42,
      volatilityPercent: 12.8,
      valueAtRisk95: 18400,
      maxDrawdownPercent: 8.7,
      diversificationScore: 78,
      notes: [
        "A pontuação de risco está moderada em relação à alocação atual.",
        "A concentração setorial permanece abaixo do limite interno de alerta."
      ]
    },
    allocation: [
      { label: "Ações", weightPercent: 54 },
      { label: "ETFs", weightPercent: 28 },
      { label: "Renda fixa", weightPercent: 12 },
      { label: "Caixa", weightPercent: 6 }
    ],
    performance: [
      { label: "Jan", returnPercent: 1.2 },
      { label: "Feb", returnPercent: 0.8 },
      { label: "Mar", returnPercent: -0.6 },
      { label: "Apr", returnPercent: 1.4 },
      { label: "May", returnPercent: 0.9 },
      { label: "Jun", returnPercent: 1.1 }
    ],
    holdings: [
      {
        symbol: "MSFT",
        name: "Microsoft",
        assetClass: "Ações",
        quantity: 120,
        weightPercent: 22,
        marketValue: 54000,
        dayChangePercent: 1.6
      },
      {
        symbol: "VTI",
        name: "Vanguard Total Stock Market ETF",
        assetClass: "ETF",
        quantity: 300,
        weightPercent: 28,
        marketValue: 68800,
        dayChangePercent: 0.9
      },
      {
        symbol: "IEF",
        name: "iShares 7-10 Year Treasury Bond ETF",
        assetClass: "Renda fixa",
        quantity: 180,
        weightPercent: 12,
        marketValue: 29400,
        dayChangePercent: -0.2
      },
      {
        symbol: "NVDA",
        name: "NVIDIA",
        assetClass: "Ações",
        quantity: 55,
        weightPercent: 18,
        marketValue: 44200,
        dayChangePercent: 2.1
      }
    ],
    transactions: [
      {
        id: "txn_001",
        tradeDate: "2026-07-12",
        type: "buy",
        description: "VTI incluído após entrada de caixa",
        quantity: 25,
        amount: 5750,
        currency: "USD",
        status: "posted"
      },
      {
        id: "txn_002",
        tradeDate: "2026-07-10",
        type: "rebalance",
        description: "Exposição individual reduzida",
        quantity: 12,
        amount: 3980,
        currency: "USD",
        status: "posted"
      },
      {
        id: "txn_003",
        tradeDate: "2026-07-08",
        type: "dividend",
        description: "Dividendo trimestral de ETF",
        quantity: 0,
        amount: 210,
        currency: "USD",
        status: "posted"
      }
    ],
    reports: [
      {
        id: "rpt_001",
        name: "Pacote mensal de risco",
        asOf: "2026-07-11T18:30:00.000Z",
        status: "ready",
        format: "pdf"
      },
      {
        id: "rpt_002",
        name: "Exportação de exposição",
        asOf: "2026-07-12T12:00:00.000Z",
        status: "ready",
        format: "csv"
      }
    ],
    alerts: [
      {
        id: "alt_001",
        title: "Single-name concentration nearing watch band",
        severity: "medium",
        status: "monitoring"
      }
    ],
    insights: [
      "A concentração em ações está elevada, mas permanece dentro do orçamento interno de risco.",
      "A cobertura de caixa segue adequada para retiradas esperadas no curto prazo."
    ],
    meta: {
      status: "ready",
      freshness: "fresh",
      asOf: "2026-07-14T09:15:00.000Z",
      lastSuccessfulSyncAt: "2026-07-14T09:10:00.000Z",
      warnings: []
    }
  });

  store.addPortfolioSnapshot({
    accountId: "acct_income",
    officeId: "ofc_private",
    accountName: "Carteira de Renda",
    membershipRole: "analyst",
    currency: "USD",
    marketValue: 128400,
    costBasis: 130900,
    unrealizedPnl: -2500,
    dayChangePercent: 0.3,
    holdingsCount: 3,
    openAlerts: 2,
    reportStatus: "generating",
    analytics: {
      riskScore: 57,
      volatilityPercent: 9.4,
      valueAtRisk95: 9600,
      maxDrawdownPercent: 6.2,
      diversificationScore: 61,
      notes: [
        "A execução mais recente do modelo fatorial está parcial porque uma fonte de dados de mercado está atrasada.",
        "A exposição à duration está acima da faixa-alvo desta carteira."
      ]
    },
    allocation: [
      { label: "Renda fixa", weightPercent: 58 },
      { label: "Ações de dividendos", weightPercent: 24 },
      { label: "REITs", weightPercent: 10 },
      { label: "Caixa", weightPercent: 8 }
    ],
    performance: [
      { label: "Jan", returnPercent: 0.6 },
      { label: "Feb", returnPercent: 0.4 },
      { label: "Mar", returnPercent: 0.1 },
      { label: "Apr", returnPercent: 0.5 },
      { label: "May", returnPercent: -0.3 },
      { label: "Jun", returnPercent: 0.2 }
    ],
    holdings: [
      {
        symbol: "LQD",
        name: "iShares iBoxx $ Investment Grade Corporate Bond ETF",
        assetClass: "Renda fixa",
        quantity: 410,
        weightPercent: 30,
        marketValue: 38500,
        dayChangePercent: 0.1
      },
      {
        symbol: "VNQ",
        name: "Vanguard Real Estate ETF",
        assetClass: "REIT",
        quantity: 160,
        weightPercent: 10,
        marketValue: 12600,
        dayChangePercent: -0.4
      },
      {
        symbol: "SCHD",
        name: "Schwab US Dividend Equity ETF",
        assetClass: "Dividend equity",
        quantity: 290,
        weightPercent: 24,
        marketValue: 30800,
        dayChangePercent: 0.6
      }
    ],
    transactions: [
      {
        id: "txn_101",
        tradeDate: "2026-07-13",
        type: "buy",
        description: "SCHD incluído para cobertura de dividendos",
        quantity: 18,
        amount: 1490,
        currency: "USD",
        status: "pending"
      },
      {
        id: "txn_102",
        tradeDate: "2026-07-09",
        type: "sell",
        description: "Exposição a títulos longos reduzida",
        quantity: 22,
        amount: 2415,
        currency: "USD",
        status: "posted"
      }
    ],
    reports: [
      {
        id: "rpt_101",
        name: "Monitoramento da carteira de renda",
        asOf: "2026-07-14T07:45:00.000Z",
        status: "generating",
        format: "pdf"
      }
    ],
    alerts: [
      {
        id: "alt_101",
        title: "Atualização de dados de mercado atrasada para uma praça de renda fixa",
        severity: "high",
        status: "open"
      },
      {
        id: "alt_102",
        title: "Exposição à duration acima da faixa-alvo",
        severity: "medium",
        status: "monitoring"
      }
    ],
    insights: [
      "Esta carteira mostra dados de mercado defasados para uma fonte; as métricas de risco são apenas direcionais.",
      "A concentração de renda está dentro dos parâmetros, mas o risco de duration deve permanecer em monitoramento."
    ],
    meta: {
      status: "degraded",
      freshness: "partial",
      asOf: "2026-07-13T22:40:00.000Z",
      lastSuccessfulSyncAt: "2026-07-13T18:05:00.000Z",
      warnings: [
        "Os dados de mercado de renda fixa estão parcialmente atrasados.",
        "A geração de relatório ainda está em execução para o snapshot mais recente."
      ]
    }
  });

  store.addLedgerPortfolio(
    {
      id: "prt_main",
      officeId: "ofc_main",
      accountId: "acct_main",
      clientId: "client_main",
      householdId: "hh_main_silva",
      name: "Core Growth",
      description: "Alocação central de longo prazo com ETFs e ações de alta capitalização.",
      baseCurrency: "USD",
      createdAt: now,
      updatedAt: new Date("2026-07-12T00:00:00.000Z")
    },
    {
      status: "ready",
      freshness: "fresh",
      analyticsState: "ready",
      marketDataState: "ready",
      analyticsAsOf: new Date("2026-07-15T12:00:00.000Z"),
      marketDataAsOf: new Date("2026-07-15T12:00:00.000Z"),
      warnings: []
    },
    [
      {
        id: "pltxn_001",
        assetSymbol: "MSFT",
        assetName: "Microsoft",
        tradeDate: "2026-07-08",
        type: "buy",
        quantity: 120,
        unitPrice: 410,
        totalAmount: 49200,
        currency: "USD",
        notes: "Posição inicial da carteira principal",
        createdAt: new Date("2026-07-08T10:00:00.000Z")
      },
      {
        id: "pltxn_002",
        assetSymbol: "VTI",
        assetName: "Vanguard Total Stock Market ETF",
        tradeDate: "2026-07-10",
        type: "buy",
        quantity: 300,
        unitPrice: 229.33,
        totalAmount: 68799,
        currency: "USD",
        notes: "Alocação ampla de mercado",
        createdAt: new Date("2026-07-10T10:00:00.000Z")
      },
      {
        id: "pltxn_003",
        assetSymbol: "NVDA",
        assetName: "NVIDIA",
        tradeDate: "2026-07-12",
        type: "buy",
        quantity: 55,
        unitPrice: 803.64,
        totalAmount: 44200.2,
        currency: "USD",
        notes: "Carteira de crescimento em IA",
        createdAt: new Date("2026-07-12T10:00:00.000Z")
      }
    ]
  );

  store.addLedgerPortfolio(
    {
      id: "prt_income",
      officeId: "ofc_private",
      accountId: "acct_income",
      clientId: "client_private",
      householdId: "hh_private_allocation",
      name: "Carteira de Renda",
      description: "Carteira de dividendos e renda fixa acompanhada pela equipe de análise.",
      baseCurrency: "USD",
      createdAt: now,
      updatedAt: new Date("2026-07-13T00:00:00.000Z")
    },
    {
      status: "degraded",
      freshness: "partial",
      analyticsState: "pending",
      marketDataState: "pending",
      warnings: [
        "Os dados de mercado de renda fixa estão parcialmente atrasados.",
        "O recálculo das análises está pendente para a transação mais recente."
      ]
    },
    [
      {
        id: "pltxn_101",
        assetSymbol: "LQD",
        assetName: "iShares iBoxx $ Investment Grade Corporate Bond ETF",
        tradeDate: "2026-07-09",
        type: "buy",
        quantity: 410,
        unitPrice: 93.9,
        totalAmount: 38499,
        currency: "USD",
        notes: "Exposição a crédito grau de investimento",
        createdAt: new Date("2026-07-09T10:00:00.000Z")
      },
      {
        id: "pltxn_102",
        assetSymbol: "VNQ",
        assetName: "Vanguard Real Estate ETF",
        tradeDate: "2026-07-10",
        type: "buy",
        quantity: 160,
        unitPrice: 78.75,
        totalAmount: 12600,
        currency: "USD",
        notes: "Carteira de renda com REITs",
        createdAt: new Date("2026-07-10T10:00:00.000Z")
      },
      {
        id: "pltxn_103",
        assetSymbol: "SCHD",
        assetName: "Schwab US Dividend Equity ETF",
        tradeDate: "2026-07-13",
        type: "buy",
        quantity: 290,
        unitPrice: 106.21,
        totalAmount: 30800.9,
        currency: "USD",
        notes: "Cobertura de dividendos",
        createdAt: new Date("2026-07-13T10:00:00.000Z")
      }
    ]
  );

  return store;
}
