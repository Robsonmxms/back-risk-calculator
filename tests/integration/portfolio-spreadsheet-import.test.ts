import ExcelJS from "exceljs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createSeededTestApp } from "../helpers/testApp";

async function login(app: Parameters<typeof request>[0], email: string) {
  const response = await request(app).post("/api/v1/auth/login").send({
    email,
    password: "Password123!"
  });
  return response.body.data.accessToken as string;
}

async function fillTemplate(
  template: Buffer,
  transactions: Array<{
    externalId?: string;
    symbol: string;
    name: string;
    date: string;
    type: "compra" | "venda";
    quantity: number;
    unitPrice: number;
    currency: string;
  }>
) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template as never);
  const portfolio = workbook.worksheets.find((sheet) => sheet.name === "Portfólio")!;
  portfolio.getCell("A2").value = "Importado da custódia";
  portfolio.getCell("B2").value = "Histórico inicial validado de forma assíncrona";
  portfolio.getCell("C2").value = "USD";
  const sheet = workbook.worksheets.find((entry) => entry.name === "Transações")!;
  transactions.forEach((transaction, index) => {
    const row = index + 2;
    sheet.getCell(row, 1).value = transaction.externalId ?? `linha-${row}`;
    sheet.getCell(row, 2).value = transaction.symbol;
    sheet.getCell(row, 3).value = transaction.name;
    sheet.getCell(row, 4).value = transaction.date;
    sheet.getCell(row, 5).value = transaction.type;
    sheet.getCell(row, 6).value = transaction.quantity;
    sheet.getCell(row, 7).value = transaction.unitPrice;
    sheet.getCell(row, 8).value = transaction.currency;
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("asynchronous portfolio spreadsheet import", () => {
  it("downloads the versioned XLSX template", async () => {
    const { app } = await createSeededTestApp();
    const token = await login(app, "user@risk.local");
    const response = await request(app)
      .get("/api/v1/portfolio-imports/template")
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers["x-template-version"]).toBe("1");
    expect(response.headers["content-disposition"]).toContain(
      "modelo-importacao-portfolio-v1.xlsx"
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body as never);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Portfólio", "Transações"]);
  });

  it("accepts a job and atomically creates a portfolio with its opening ledger", async () => {
    const context = await createSeededTestApp({ portfolioImports: { autoProcess: false } });
    const token = await login(context.app, "user@risk.local");
    const template = await context.portfolioImports.workbook.createTemplate();
    const file = await fillTemplate(template, [
      {
        symbol: "MSFT",
        name: "Microsoft Corporation",
        date: "10/07/2026",
        type: "compra",
        quantity: 10,
        unitPrice: 400,
        currency: "USD"
      },
      {
        symbol: "MSFT",
        name: "Microsoft Corporation",
        date: "12/07/2026",
        type: "venda",
        quantity: 2,
        unitPrice: 420,
        currency: "USD"
      }
    ]);

    const accepted = await request(context.app)
      .post("/api/v1/portfolio-imports")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "import-success-001")
      .field("accountId", "acct_main")
      .attach("file", file, {
        filename: "portfolio.xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
    expect(accepted.status).toBe(202);
    expect(accepted.body.data.status).toBe("queued");

    await context.portfolioImports.worker.drain();
    const status = await request(context.app)
      .get(`/api/v1/portfolio-imports/${accepted.body.data.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(status.body.data).toMatchObject({
      status: "succeeded",
      phase: "completed",
      progress: { totalRows: 2, succeededRows: 2, failedRows: 0 }
    });

    const portfolioId = status.body.data.portfolioId as string;
    const detail = await request(context.app)
      .get(`/api/v1/portfolios/${portfolioId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detail.body.data).toMatchObject({
      name: "Importado da custódia",
      accountId: "acct_main",
      transactionCount: 2,
      holdingsCount: 1
    });
    const transactions = await request(context.app)
      .get(`/api/v1/portfolios/${portfolioId}/transactions`)
      .set("Authorization", `Bearer ${token}`);
    expect(transactions.body.data.transactions).toHaveLength(2);

    const snapshots = await request(context.app)
      .get(`/api/v1/portfolios/${portfolioId}/snapshots`)
      .set("Authorization", `Bearer ${token}`);
    expect(snapshots.body.data.snapshots).toHaveLength(2);
    expect(snapshots.body.data.snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ asOfDate: "2026-07-10", transactionCount: 1 }),
        expect.objectContaining({ asOfDate: "2026-07-12", transactionCount: 2 })
      ])
    );
    expect(
      snapshots.body.data.snapshots.every(
        (snapshot: { transactionCount: number }) => snapshot.transactionCount > 0
      )
    ).toBe(true);
  });

  it("fails all-or-nothing and generates the two-sheet error workbook", async () => {
    const context = await createSeededTestApp({ portfolioImports: { autoProcess: false } });
    const token = await login(context.app, "user@risk.local");
    const template = await context.portfolioImports.workbook.createTemplate();
    const file = await fillTemplate(template, [
      {
        symbol: "MSFT",
        name: "Microsoft Corporation",
        date: "10/07/2026",
        type: "venda",
        quantity: 10,
        unitPrice: 400,
        currency: "USD"
      }
    ]);
    const before = await request(context.app)
      .get("/api/v1/portfolios")
      .set("Authorization", `Bearer ${token}`);
    const accepted = await request(context.app)
      .post("/api/v1/portfolio-imports")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "import-failed-001")
      .field("accountId", "acct_main")
      .attach("file", file, { filename: "portfolio.xlsx" });

    await context.portfolioImports.worker.drain();
    const status = await request(context.app)
      .get(`/api/v1/portfolio-imports/${accepted.body.data.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(status.body.data).toMatchObject({
      status: "failed",
      phase: "validation_failed",
      portfolioId: null,
      errorReportAvailable: true
    });
    expect(status.body.data.failure.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "portfolio.negative_position" })])
    );

    const after = await request(context.app)
      .get("/api/v1/portfolios")
      .set("Authorization", `Bearer ${token}`);
    expect(after.body.data.portfolios).toHaveLength(before.body.data.portfolios.length);

    const report = await request(context.app)
      .get(`/api/v1/portfolio-imports/${accepted.body.data.id}/error-report`)
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(report.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(report.body as never);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Linhas com Erro", "Erros"]);
    expect(workbook.worksheets[0].rowCount).toBe(2);
    expect(workbook.worksheets[1].getCell("D2").value).toBe("portfolio.negative_position");
  });

  it("enforces authorization and request idempotency", async () => {
    const context = await createSeededTestApp({ portfolioImports: { autoProcess: false } });
    const ownerToken = await login(context.app, "user@risk.local");
    const otherToken = await login(context.app, "other@risk.local");
    const template = await context.portfolioImports.workbook.createTemplate();
    const file = await fillTemplate(template, [
      {
        symbol: "MSFT",
        name: "Microsoft Corporation",
        date: "10/07/2026",
        type: "compra",
        quantity: 1,
        unitPrice: 400,
        currency: "USD"
      }
    ]);
    const forbidden = await request(context.app)
      .post("/api/v1/portfolio-imports")
      .set("Authorization", `Bearer ${otherToken}`)
      .set("Idempotency-Key", "forbidden-001")
      .field("accountId", "acct_main")
      .attach("file", file, { filename: "portfolio.xlsx" });
    expect(forbidden.status).toBe(403);

    const first = await request(context.app)
      .post("/api/v1/portfolio-imports")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", "same-import-001")
      .field("accountId", "acct_main")
      .attach("file", file, { filename: "portfolio.xlsx" });
    const second = await request(context.app)
      .post("/api/v1/portfolio-imports")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", "same-import-001")
      .field("accountId", "acct_main")
      .attach("file", file, { filename: "portfolio.xlsx" });
    expect(second.status).toBe(202);
    expect(second.body.data.id).toBe(first.body.data.id);
  });
});
