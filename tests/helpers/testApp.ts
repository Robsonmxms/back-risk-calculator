import { createApp } from "../../src/app";
import type { AppDependencies } from "../../src/04-infra/container/SharedContainer";
import { createSeededIdentityStore } from "./seededIdentityStore";

export async function createSeededTestApp(dependencies: AppDependencies = {}) {
  const identityStore = dependencies.identityStore ?? (await createSeededIdentityStore());
  return createApp({
    ...dependencies,
    identityStore
  });
}
