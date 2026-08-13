import { PortfolioSummary } from "../portfolios/portfolio";

export type ClientStatus = "active" | "inactive" | "archived";
export type ClientOnboardingStatus = "invited" | "onboarding" | "complete" | "paused";
export type HouseholdStatus = "active" | "archived";

export interface Household {
  id: string;
  officeId: string;
  name: string;
  status: HouseholdStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClientProfile {
  id: string;
  officeId: string;
  householdId?: string;
  name: string;
  email: string;
  phone?: string;
  documentLabel?: string;
  status: ClientStatus;
  onboardingStatus: ClientOnboardingStatus;
  advisorUserId?: string;
  riskProfileDescriptor: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date;
}

export interface ClientAccountSummary {
  id: string;
  name: string;
  officeId: string;
  portfolioCount: number;
}

export interface ClientSummary extends ClientProfile {
  householdName?: string;
  advisorName?: string;
  accountCount: number;
  portfolioCount: number;
}

export interface ClientDetail extends ClientSummary {
  household?: Household;
  accounts: ClientAccountSummary[];
  portfolios: PortfolioSummary[];
}
