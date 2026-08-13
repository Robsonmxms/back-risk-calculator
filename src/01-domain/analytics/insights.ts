import { randomUUID } from "crypto";
import {
  AnalyticsMetricSet,
  AnalyticsPosition,
  DataQualityIssue,
  RiskInsight,
  SectorExposurePoint
} from "./types";

const POSITION_CONCENTRATION_THRESHOLD = 35;
const SECTOR_CONCENTRATION_THRESHOLD = 45;
const HHI_WATCH_THRESHOLD = 0.25;
const MAX_DRAWDOWN_WATCH_THRESHOLD = -0.1;

export function generateRiskInsights(input: {
  metrics: AnalyticsMetricSet;
  positions: AnalyticsPosition[];
  sectorExposure: SectorExposurePoint[];
  dataQualityIssues: DataQualityIssue[];
}): RiskInsight[] {
  const insights: RiskInsight[] = [];
  const largestPosition = [...input.positions]
    .filter((position) => position.weightPercent !== undefined)
    .sort((left, right) => (right.weightPercent ?? 0) - (left.weightPercent ?? 0))[0];

  if (
    largestPosition?.weightPercent !== undefined &&
    largestPosition.weightPercent >= POSITION_CONCENTRATION_THRESHOLD
  ) {
    insights.push({
      id: randomUUID(),
      severity: "watch",
      title: "Concentração por ativo elevada",
      explanation: `${largestPosition.assetSymbol} representa ${formatNumber(
        largestPosition.weightPercent,
        1
      )}% do valor estimado em USD. Isso aumenta a sensibilidade do portfólio a eventos específicos desse ativo.`,
      metricKeys: ["concentrationHhi"],
      symbols: [largestPosition.assetSymbol]
    });
  }

  const hhi = input.metrics.concentrationHhi.value;
  if (hhi !== undefined && hhi >= HHI_WATCH_THRESHOLD) {
    insights.push({
      id: randomUUID(),
      severity: "watch",
      title: "Concentração agregada em observação",
      explanation: `O HHI de ${formatNumber(
        hhi,
        3
      )} indica concentração na distribuição dos pesos. A leitura é explicativa e deve ser combinada com o mandato do portfólio.`,
      metricKeys: ["concentrationHhi"]
    });
  }

  const largestSector = input.sectorExposure[0];
  if (largestSector && largestSector.weightPercent >= SECTOR_CONCENTRATION_THRESHOLD) {
    insights.push({
      id: randomUUID(),
      severity: "watch",
      title: "Exposição setorial concentrada",
      explanation: `${localizeSector(largestSector.sector)} concentra ${formatNumber(
        largestSector.weightPercent,
        1
      )}% do portfólio em USD. Choques nesse setor podem explicar parte relevante da volatilidade total.`,
      metricKeys: ["sectorExposure"]
    });
  }

  const maxDrawdown = input.metrics.maxDrawdown.value;
  if (maxDrawdown !== undefined && maxDrawdown <= MAX_DRAWDOWN_WATCH_THRESHOLD) {
    insights.push({
      id: randomUUID(),
      severity: "high",
      title: "Drawdown recente material",
      explanation: `O maior drawdown calculado foi ${formatNumber(
        maxDrawdown * 100,
        1
      )}%. Essa medida descreve a perda desde o pico histórico da janela analisada, sem projetar perdas futuras.`,
      metricKeys: ["maxDrawdown"]
    });
  }

  if (input.dataQualityIssues.length > 0) {
    insights.push({
      id: randomUUID(),
      severity: "info",
      title: "Leitura parcial de dados",
      explanation:
        "Algumas métricas dependem de cotações, histórico ou câmbio indisponíveis. O retrato de risco preserva os valores calculáveis e sinaliza as lacunas de qualidade.",
      metricKeys: input.dataQualityIssues.flatMap((issue) => issue.metricKeys ?? [])
    });
  }

  return insights;
}

function formatNumber(value: number, fractionDigits: number): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(value);
}

function localizeSector(value: string): string {
  const labels: Record<string, string> = {
    Energy: "Energia",
    Financials: "Serviços financeiros",
    Materials: "Materiais",
    "Real Estate": "Imobiliário",
    Technology: "Tecnologia"
  };
  return labels[value] ?? value;
}
