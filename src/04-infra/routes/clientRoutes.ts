import { Router } from "express";
import { AuthenticateAccessTokenUseCase } from "../../02-application/auth/use-cases/authenticate-access-token-use-case";
import { ClientController } from "../../03-adapters/controllers/ClientController";
import {
  createClientSchema,
  createHouseholdSchema,
  listClientsQuerySchema,
  updateClientSchema,
  updateHouseholdSchema
} from "../../03-adapters/controllers/client-schemas";
import { asyncHandler } from "../../03-adapters/http";
import { authMiddleware } from "../../03-adapters/middlewares/AuthMiddleware";
import { validateBody, validateQuery } from "../../03-adapters/validation";

export function registerClientRoutes(
  router: Router,
  controller: ClientController,
  authenticateAccessTokenUseCase: AuthenticateAccessTokenUseCase
): void {
  const auth = authMiddleware(authenticateAccessTokenUseCase);

  router.get(
    "/offices/:officeId/clients",
    auth,
    validateQuery(listClientsQuerySchema),
    asyncHandler(controller.listClients)
  );
  router.post(
    "/offices/:officeId/clients",
    auth,
    validateBody(createClientSchema),
    asyncHandler(controller.createClient)
  );
  router.get("/clients/:clientId", auth, asyncHandler(controller.getClient));
  router.patch(
    "/clients/:clientId",
    auth,
    validateBody(updateClientSchema),
    asyncHandler(controller.updateClient)
  );
  router.get("/offices/:officeId/households", auth, asyncHandler(controller.listHouseholds));
  router.post(
    "/offices/:officeId/households",
    auth,
    validateBody(createHouseholdSchema),
    asyncHandler(controller.createHousehold)
  );
  router.patch(
    "/households/:householdId",
    auth,
    validateBody(updateHouseholdSchema),
    asyncHandler(controller.updateHousehold)
  );
}
