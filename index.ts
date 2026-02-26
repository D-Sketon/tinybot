import { runTinybotCli } from "./src/index.ts";

if (import.meta.main) {
  // eslint-disable-next-line antfu/no-top-level-await
  await runTinybotCli();
}

export * from "./src/index.ts";
