import { expect, test } from "bun:test";
import { databaseUrl, foreignHolders } from "./stack.ts";

test("databaseUrl: POSTGRES_* with the compose defaults", () => {
  expect(databaseUrl({})).toBe("postgresql://foundry:foundry@localhost:5432/foundry");
  expect(databaseUrl({ POSTGRES_DB: "d", POSTGRES_PASSWORD: "p", POSTGRES_PORT: "15432", POSTGRES_USER: "u" })).toBe("postgresql://u:p@localhost:15432/d");
});

test("foreignHolders: a container from another project holds the volume; ours does not count", () => {
  const ps = "foundry-postgres\tfoundry\ncitadel-postgres-1\tcitadel\nstray\t\n";
  expect(foreignHolders(ps, "citadel")).toEqual(["foundry-postgres (project foundry)", "stray (project none)"]);
  expect(foreignHolders("", "citadel")).toEqual([]);
});
