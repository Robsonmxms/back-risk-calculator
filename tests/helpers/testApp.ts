import { createApp, type AppDependencies } from "../../src/app";
import { createSeededIdentityStore } from "./seededIdentityStore";
import { createTestRuntimeConfig } from "./testRuntimeConfig";

export async function createSeededTestApp(dependencies: AppDependencies = {}) {
  const identityStore = dependencies.identityStore ?? (await createSeededIdentityStore());
  return createApp({
    ...dependencies,
    runtimeConfig: dependencies.runtimeConfig ?? createTestRuntimeConfig(),
    identityStore
  });
}
