import Busboy from "busboy";
import { NextFunction, Request, Response } from "express";
import { UploadedPortfolioWorkbook } from "../../02-application/portfolio-imports/use-cases";
import { ApiError } from "../http";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface PortfolioImportMultipartRequest extends Request {
  portfolioImportFile?: UploadedPortfolioWorkbook;
}

export function parsePortfolioImportMultipart(
  request: Request,
  _response: Response,
  next: NextFunction
) {
  if (!request.headers["content-type"]?.startsWith("multipart/form-data")) {
    return next(
      new ApiError(
        400,
        "request.invalid_multipart",
        "Use multipart/form-data para enviar a planilha"
      )
    );
  }

  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({
      headers: request.headers,
      limits: { files: 1, fields: 4, fileSize: MAX_UPLOAD_BYTES, parts: 5 }
    });
  } catch {
    return next(new ApiError(400, "request.invalid_multipart", "Upload multipart inválido"));
  }

  const chunks: Buffer[] = [];
  let accountId = "";
  let fileName = "";
  let mediaType = "";
  let fileTooLarge = false;
  let settled = false;

  parser.on("field", (name, value) => {
    if (name === "accountId") {
      accountId = value.trim();
    }
  });
  parser.on("file", (name, file, info) => {
    if (name !== "file") {
      file.resume();
      return;
    }
    fileName = info.filename;
    mediaType = info.mimeType;
    file.on("limit", () => {
      fileTooLarge = true;
    });
    file.on("data", (chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));
    });
  });
  parser.on("filesLimit", () =>
    finishWithError(new ApiError(400, "request.invalid_multipart", "Envie apenas uma planilha"))
  );
  parser.on("partsLimit", () =>
    finishWithError(new ApiError(400, "request.invalid_multipart", "O upload contém partes demais"))
  );
  parser.on("error", () =>
    finishWithError(new ApiError(400, "request.invalid_multipart", "Não foi possível ler o upload"))
  );
  parser.on("close", () => {
    if (settled) return;
    if (fileTooLarge) {
      return finishWithError(
        new ApiError(413, "portfolio_import.file_too_large", "A planilha excede 10 MiB")
      );
    }
    if (!accountId) {
      return finishWithError(
        new ApiError(400, "request.validation_failed", "Selecione uma conta", {
          fields: [{ path: "accountId", message: "accountId is required" }]
        })
      );
    }
    if (!fileName || chunks.length === 0) {
      return finishWithError(
        new ApiError(400, "request.validation_failed", "Selecione uma planilha", {
          fields: [{ path: "file", message: "file is required" }]
        })
      );
    }
    settled = true;
    request.body = { accountId };
    (request as PortfolioImportMultipartRequest).portfolioImportFile = {
      originalFileName: fileName,
      mediaType,
      content: Buffer.concat(chunks)
    };
    return next();
  });

  function finishWithError(error: ApiError) {
    if (settled) return;
    settled = true;
    next(error);
  }

  request.pipe(parser);
}
