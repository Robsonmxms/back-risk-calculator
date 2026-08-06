import { createApp, type AppDependencies } from "../../src/app";
import { createSeededIdentityStore } from "./seededIdentityStore";

export async function createSeededTestApp(dependencies: AppDependencies = {}) {
  const identityStore = dependencies.identityStore ?? (await createSeededIdentityStore());
  return createApp({
    ...dependencies,
    identityStore
  });
}
