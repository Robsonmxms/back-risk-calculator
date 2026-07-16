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
      title: "Concentracao por ativo elevada",
      explanation: `${largestPosition.assetSymbol} representa ${largestPosition.weightPercent.toFixed(
        1
      )}% do valor estimado em USD. Isso aumenta a sensibilidade do portfolio a eventos especificos desse ativo.`,
      metricKeys: ["concentrationHhi"],
      symbols: [largestPosition.assetSymbol]
    });
  }

  const hhi = input.metrics.concentrationHhi.value;
  if (hhi !== undefined && hhi >= HHI_WATCH_THRESHOLD) {
    insights.push({
      id: randomUUID(),
      severity: "watch",
      title: "Concentracao agregada em observacao",
      explanation: `O HHI de ${hhi.toFixed(
        3
      )} indica que a distribuicao de pesos esta concentrada. A leitura e explicativa e deve ser combinada com o mandato do portfolio.`,
      metricKeys: ["concentrationHhi"]
    });
  }

  const largestSector = input.sectorExposure[0];
  if (largestSector && largestSector.weightPercent >= SECTOR_CONCENTRATION_THRESHOLD) {
    insights.push({
      id: randomUUID(),
      severity: "watch",
      title: "Exposicao setorial concentrada",
      explanation: `${largestSector.sector} concentra ${largestSector.weightPercent.toFixed(
        1
      )}% do portfolio em USD. Choques nesse setor podem explicar parte relevante da volatilidade total.`,
      metricKeys: ["sectorExposure"]
    });
  }

  const maxDrawdown = input.metrics.maxDrawdown.value;
  if (maxDrawdown !== undefined && maxDrawdown <= MAX_DRAWDOWN_WATCH_THRESHOLD) {
    insights.push({
      id: randomUUID(),
      severity: "high",
      title: "Drawdown recente material",
      explanation: `O maior drawdown calculado foi ${(maxDrawdown * 100).toFixed(
        1
      )}%. Essa medida descreve perda desde pico historico da janela analisada, sem projetar perdas futuras.`,
      metricKeys: ["maxDrawdown"]
    });
  }

  if (input.dataQualityIssues.length > 0) {
    insights.push({
      id: randomUUID(),
      severity: "info",
      title: "Leitura parcial de dados",
      explanation:
        "Algumas metricas dependem de cotacoes, historico ou cambio indisponiveis. O snapshot preserva os valores calculaveis e sinaliza as lacunas de qualidade.",
      metricKeys: input.dataQualityIssues.flatMap((issue) => issue.metricKeys ?? [])
    });
  }

  return insights;
}
