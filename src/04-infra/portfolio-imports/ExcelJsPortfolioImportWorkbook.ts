import ExcelJS, { CellValue, Row, Worksheet } from "exceljs";
import {
  NormalizedPortfolioImportTransaction,
  ParsedPortfolioImportWorkbook,
  PortfolioImportRowError
} from "../../01-domain/portfolio-imports/portfolio-import";
import { PortfolioImportWorkbookService } from "../../02-application/portfolio-imports/ports";

const TEMPLATE_VERSION = 1;
const PORTFOLIO_SHEET = "Portfólio";
const TRANSACTIONS_SHEET = "Transações";
const PORTFOLIO_HEADERS = ["nome", "descricao", "moeda_base"];
const TRANSACTION_HEADERS = [
  "identificador_externo",
  "simbolo_ativo",
  "nome_ativo",
  "data_negociacao",
  "tipo",
  "quantidade",
  "preco_unitario",
  "moeda",
  "observacoes"
];
const SUPPORTED_CURRENCIES = new Set([
  "USD",
  "BRL",
  "EUR",
  "GBP",
  "JPY",
  "CAD",
  "AUD",
  "CHF",
  "MXN"
]);
const MAX_ROWS = 10_000;

export class ExcelJsPortfolioImportWorkbook implements PortfolioImportWorkbookService {
  async createTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Risk Calculator";
    workbook.created = new Date(0);
    workbook.modified = new Date(0);

    const portfolio = workbook.addWorksheet(PORTFOLIO_SHEET, {
      views: [{ state: "frozen", ySplit: 1 }]
    });
    portfolio.addRow(PORTFOLIO_HEADERS);
    portfolio.getCell("Z1").value = "template_version";
    portfolio.getCell("Z2").value = TEMPLATE_VERSION;
    portfolio.getColumn(26).hidden = true;
    styleHeader(portfolio, PORTFOLIO_HEADERS.length);
    portfolio.columns = [
      { key: "nome", width: 32 },
      { key: "descricao", width: 52 },
      { key: "moeda_base", width: 18 }
    ];

    const transactions = workbook.addWorksheet(TRANSACTIONS_SHEET, {
      views: [{ state: "frozen", ySplit: 1 }]
    });
    transactions.addRow(TRANSACTION_HEADERS);
    styleHeader(transactions, TRANSACTION_HEADERS.length);
    transactions.columns = [
      { width: 24 },
      { width: 18 },
      { width: 34 },
      { width: 20 },
      { width: 14 },
      { width: 16 },
      { width: 18 },
      { width: 12 },
      { width: 44 }
    ];
    transactions.getColumn(4).numFmt = "dd/mm/yyyy";
    transactions.getColumn(6).numFmt = "0.00000000";
    transactions.getColumn(7).numFmt = "0.00000000";

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async parse(content: Buffer): Promise<ParsedPortfolioImportWorkbook> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(content as never);
    } catch {
      return invalidWorkbook(
        "portfolio_import.invalid_workbook",
        "O arquivo XLSX está corrompido."
      );
    }

    const errors: PortfolioImportRowError[] = [];
    const expectedSheets = new Set([PORTFOLIO_SHEET, TRANSACTIONS_SHEET]);
    for (const worksheet of workbook.worksheets) {
      if (!expectedSheets.has(worksheet.name)) {
        errors.push(
          error(
            0,
            "worksheet",
            "portfolio_import.unknown_worksheet",
            `A aba ${worksheet.name} não é permitida.`
          )
        );
      }
      if (worksheet.state !== "visible") {
        errors.push(
          error(
            0,
            "worksheet",
            "portfolio_import.hidden_worksheet",
            `A aba ${worksheet.name} não pode estar oculta.`
          )
        );
      }
      worksheet.eachRow((row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          if (isFormula(cell.value)) {
            errors.push(
              error(
                row.number,
                columnName(Number(cell.col)),
                "portfolio_import.formula_not_allowed",
                "Fórmulas não são permitidas."
              )
            );
          }
          if (isHyperlink(cell.value)) {
            errors.push(
              error(
                row.number,
                columnName(Number(cell.col)),
                "portfolio_import.external_link_not_allowed",
                "Links externos não são permitidos."
              )
            );
          }
        });
      });
    }

    const portfolioSheet = findWorksheet(workbook, PORTFOLIO_SHEET);
    const transactionSheet = findWorksheet(workbook, TRANSACTIONS_SHEET);
    if (!portfolioSheet) {
      errors.push(
        error(
          0,
          "worksheet",
          "portfolio_import.portfolio_sheet_missing",
          "A aba Portfólio é obrigatória."
        )
      );
    }
    if (!transactionSheet) {
      errors.push(
        error(
          0,
          "worksheet",
          "portfolio_import.transactions_sheet_missing",
          "A aba Transações é obrigatória."
        )
      );
    }

    const templateVersion = Number(portfolioSheet?.getCell("Z2").value ?? 0);
    if (templateVersion !== TEMPLATE_VERSION) {
      errors.push(
        error(
          0,
          "template_version",
          "portfolio_import.template_version_unsupported",
          "Baixe e utilize a versão atual do modelo."
        )
      );
    }

    if (portfolioSheet) {
      validateHeaders(portfolioSheet, PORTFOLIO_HEADERS, errors, new Set([26]));
    }
    if (transactionSheet) {
      validateHeaders(transactionSheet, TRANSACTION_HEADERS, errors);
    }

    const portfolio = parsePortfolio(portfolioSheet, errors);
    const transactions = parseTransactions(transactionSheet, errors);
    validateOpeningLedger(transactions, errors);

    return {
      templateVersion,
      portfolio,
      transactions,
      errors: deduplicateErrors(errors)
    };
  }

  async createErrorReport(errors: PortfolioImportRowError[], source?: Buffer): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const lines = workbook.addWorksheet("Linhas com Erro");
    const sourceWorkbook = source ? await loadSourceSafely(source) : undefined;
    const sourceSheet = sourceWorkbook
      ? findWorksheet(sourceWorkbook, TRANSACTIONS_SHEET)
      : undefined;
    const rowNumbers = Array.from(
      new Set(errors.map((entry) => entry.rowNumber).filter((rowNumber) => rowNumber > 0))
    ).sort((left, right) => left - right);

    if (sourceSheet) {
      lines.addRow(TRANSACTION_HEADERS);
      for (const rowNumber of rowNumbers) {
        const sourceRow = sourceSheet.getRow(rowNumber);
        lines.addRow(
          TRANSACTION_HEADERS.map((_, index) => safeReportValue(sourceRow.getCell(index + 1).value))
        );
      }
    } else {
      lines.addRow(["linha_original"]);
      for (const rowNumber of rowNumbers) {
        lines.addRow([rowNumber]);
      }
    }
    styleHeader(lines, lines.columnCount);

    const details = workbook.addWorksheet("Erros");
    details.addRow(["linha", "linha_no_original", "campo", "codigo_erro", "mensagem"]);
    styleHeader(details, 5);
    const mappedRow = new Map(rowNumbers.map((rowNumber, index) => [rowNumber, index + 2]));
    for (const entry of errors) {
      details.addRow([
        mappedRow.get(entry.rowNumber) ?? "",
        entry.rowNumber || "",
        safeReportValue(entry.field),
        safeReportValue(entry.code),
        safeReportValue(entry.message)
      ]);
    }
    details.columns = [{ width: 12 }, { width: 20 }, { width: 28 }, { width: 44 }, { width: 70 }];

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}

function parsePortfolio(
  sheet: Worksheet | undefined,
  errors: PortfolioImportRowError[]
): ParsedPortfolioImportWorkbook["portfolio"] {
  if (!sheet) {
    return { name: "", baseCurrency: "" };
  }
  const nonEmptyRows: Row[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (PORTFOLIO_HEADERS.some((_, index) => text(row.getCell(index + 1).value))) {
      nonEmptyRows.push(row);
    }
  }
  if (nonEmptyRows.length !== 1) {
    errors.push(
      error(
        2,
        "portfolio",
        "portfolio_import.portfolio_row_count",
        "Informe exatamente um portfólio."
      )
    );
  }
  const row = nonEmptyRows[0] ?? sheet.getRow(2);
  const name = text(row.getCell(1).value);
  const description = text(row.getCell(2).value);
  const baseCurrency = text(row.getCell(3).value).toUpperCase();
  if (name.length < 2 || name.length > 120) {
    errors.push(
      error(
        row.number,
        "nome",
        "portfolio_import.invalid_name",
        "O nome deve ter entre 2 e 120 caracteres."
      )
    );
  }
  if (description.length > 400) {
    errors.push(
      error(
        row.number,
        "descricao",
        "portfolio_import.invalid_description",
        "A descrição deve ter no máximo 400 caracteres."
      )
    );
  }
  if (!SUPPORTED_CURRENCIES.has(baseCurrency)) {
    errors.push(
      error(
        row.number,
        "moeda_base",
        "portfolio_import.unsupported_currency",
        "Informe uma moeda base suportada."
      )
    );
  }
  return { name, description: description || undefined, baseCurrency };
}

function parseTransactions(
  sheet: Worksheet | undefined,
  errors: PortfolioImportRowError[]
): NormalizedPortfolioImportTransaction[] {
  if (!sheet) {
    return [];
  }
  const transactions: NormalizedPortfolioImportTransaction[] = [];
  const externalIds = new Set<string>();
  let nonEmptyRows = 0;
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (!TRANSACTION_HEADERS.some((_, index) => text(row.getCell(index + 1).value))) {
      continue;
    }
    nonEmptyRows += 1;
    if (nonEmptyRows > MAX_ROWS) {
      errors.push(
        error(
          rowNumber,
          "row",
          "portfolio_import.row_limit_exceeded",
          `A planilha excede o limite de ${MAX_ROWS} transações.`
        )
      );
      break;
    }
    const rowErrorsBefore = errors.length;
    const externalId = text(row.getCell(1).value);
    const assetSymbol = text(row.getCell(2).value).toUpperCase();
    const assetName = text(row.getCell(3).value);
    const tradeDate = dateOnly(row.getCell(4).value);
    const typeValue = text(row.getCell(5).value).toLowerCase();
    const quantity = positiveNumber(row.getCell(6).value);
    const unitPrice = positiveNumber(row.getCell(7).value);
    const currency = text(row.getCell(8).value).toUpperCase();
    const notes = text(row.getCell(9).value);

    if (externalId && externalIds.has(externalId)) {
      errors.push(
        error(
          rowNumber,
          "identificador_externo",
          "portfolio_import.duplicate_external_id",
          "O identificador externo está duplicado."
        )
      );
    }
    if (externalId) externalIds.add(externalId);
    if (!assetSymbol || assetSymbol.length > 24)
      errors.push(
        error(
          rowNumber,
          "simbolo_ativo",
          "portfolio_import.invalid_asset_symbol",
          "Informe um símbolo de ativo válido."
        )
      );
    if (!assetName || assetName.length > 160)
      errors.push(
        error(
          rowNumber,
          "nome_ativo",
          "portfolio_import.invalid_asset_name",
          "Informe um nome de ativo válido."
        )
      );
    if (!tradeDate)
      errors.push(
        error(
          rowNumber,
          "data_negociacao",
          "portfolio_import.invalid_trade_date",
          "Informe uma data válida em dd/mm/aaaa."
        )
      );
    if (typeValue !== "compra" && typeValue !== "venda")
      errors.push(
        error(
          rowNumber,
          "tipo",
          "portfolio_import.invalid_transaction_type",
          "Use compra ou venda."
        )
      );
    if (quantity === undefined)
      errors.push(
        error(
          rowNumber,
          "quantidade",
          "portfolio_import.invalid_quantity",
          "Informe uma quantidade positiva."
        )
      );
    if (unitPrice === undefined)
      errors.push(
        error(
          rowNumber,
          "preco_unitario",
          "portfolio_import.invalid_unit_price",
          "Informe um preço unitário positivo."
        )
      );
    if (!SUPPORTED_CURRENCIES.has(currency))
      errors.push(
        error(
          rowNumber,
          "moeda",
          "portfolio_import.unsupported_currency",
          "Informe uma moeda suportada."
        )
      );
    if (notes.length > 400)
      errors.push(
        error(
          rowNumber,
          "observacoes",
          "portfolio_import.invalid_notes",
          "As observações devem ter no máximo 400 caracteres."
        )
      );

    if (errors.length === rowErrorsBefore) {
      transactions.push({
        rowNumber,
        externalId: externalId || undefined,
        assetSymbol,
        assetName,
        tradeDate: tradeDate!,
        type: typeValue === "compra" ? "buy" : "sell",
        quantity: quantity!,
        unitPrice: unitPrice!,
        currency,
        notes: notes || undefined
      });
    }
  }
  if (nonEmptyRows === 0) {
    errors.push(
      error(
        2,
        "transactions",
        "portfolio_import.transactions_required",
        "Informe ao menos uma transação."
      )
    );
  }
  return transactions.sort(
    (left, right) =>
      left.tradeDate.localeCompare(right.tradeDate) || left.rowNumber - right.rowNumber
  );
}

function validateOpeningLedger(
  transactions: NormalizedPortfolioImportTransaction[],
  errors: PortfolioImportRowError[]
) {
  const positions = new Map<string, number>();
  for (const transaction of transactions) {
    const current = positions.get(transaction.assetSymbol) ?? 0;
    const next =
      transaction.type === "buy" ? current + transaction.quantity : current - transaction.quantity;
    if (next < 0) {
      errors.push(
        error(
          transaction.rowNumber,
          "quantidade",
          "portfolio.negative_position",
          "A venda deixaria a posição do ativo negativa."
        )
      );
    } else {
      positions.set(transaction.assetSymbol, next);
    }
  }
}

function validateHeaders(
  sheet: Worksheet,
  expected: string[],
  errors: PortfolioImportRowError[],
  ignoredColumns = new Set<number>()
) {
  expected.forEach((header, index) => {
    if (text(sheet.getRow(1).getCell(index + 1).value).toLowerCase() !== header) {
      errors.push(
        error(
          1,
          header,
          "portfolio_import.invalid_header",
          `A coluna ${header} é obrigatória e deve manter o nome do modelo.`
        )
      );
    }
  });
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => {
    if (column > expected.length && !ignoredColumns.has(column) && text(cell.value)) {
      errors.push(
        error(
          1,
          columnName(column),
          "portfolio_import.unknown_column",
          `A coluna ${text(cell.value)} não é permitida.`
        )
      );
    }
  });
}

function invalidWorkbook(code: string, message: string): ParsedPortfolioImportWorkbook {
  return {
    templateVersion: 0,
    portfolio: { name: "", baseCurrency: "" },
    transactions: [],
    errors: [error(0, "file", code, message)]
  };
}

function error(
  rowNumber: number,
  field: string,
  code: string,
  message: string
): PortfolioImportRowError {
  return { rowNumber, field, code, message };
}

function text(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText
        .map((part) => part.text)
        .join("")
        .trim();
    }
    return "";
  }
  return String(value).trim();
}

function positiveNumber(value: CellValue): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined;
  const normalized = text(value).replace(",", ".");
  if (!/^\d+(?:[.,]\d+)?$/.test(text(value))) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function dateOnly(value: CellValue): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  }
  const match = text(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return undefined;
  const [, day, month, year] = match;
  const candidate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    candidate.getUTCFullYear() !== Number(year) ||
    candidate.getUTCMonth() + 1 !== Number(month) ||
    candidate.getUTCDate() !== Number(day)
  )
    return undefined;
  return `${year}-${month}-${day}`;
}

function isFormula(value: CellValue): boolean {
  return Boolean(value && typeof value === "object" && "formula" in value);
}

function isHyperlink(value: CellValue): boolean {
  return Boolean(value && typeof value === "object" && "hyperlink" in value);
}

function safeReportValue(value: CellValue): string | number | Date | null {
  if (value instanceof Date || typeof value === "number") return value;
  let result = text(value);
  if (/^[=+\-@]/.test(result)) result = `'${result}`;
  return result || null;
}

function columnName(column: number): string {
  let name = "";
  let value = column;
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function styleHeader(sheet: Worksheet, count: number) {
  for (let column = 1; column <= count; column += 1) {
    const cell = sheet.getRow(1).getCell(column);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF29463D" } };
    cell.alignment = { vertical: "middle" };
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: count } };
}

function deduplicateErrors(errors: PortfolioImportRowError[]): PortfolioImportRowError[] {
  const seen = new Set<string>();
  return errors.filter((entry) => {
    const key = `${entry.rowNumber}:${entry.field}:${entry.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadSourceSafely(source: Buffer): Promise<ExcelJS.Workbook | undefined> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(source as never);
    return workbook;
  } catch {
    return undefined;
  }
}

function findWorksheet(workbook: ExcelJS.Workbook, name: string): Worksheet | undefined {
  return workbook.worksheets.find((worksheet) => worksheet.name === name);
}
