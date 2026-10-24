import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncNotionSkill } from "./sync-notion-skill";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true });
});
async function files(repository = "repository", global = "global") {
  const directory = await mkdtemp(join(tmpdir(), "jv-notion-sync-"));
  directories.push(directory);
  const repositoryFile = join(directory, "repository.md");
  const globalFile = join(directory, "global.md");
  await writeFile(repositoryFile, repository);
  await writeFile(globalFile, global);
  return { directory, repositoryFile, globalFile };
}
test("check accepts identical files", async () => {
  const { repositoryFile, globalFile } = await files("same", "same");
  expect(await syncNotionSkill(repositoryFile, globalFile)).toBe(
    "Already in sync.",
  );
});
test("check detects drift without changing either file", async () => {
  const { repositoryFile, globalFile } = await files();
  await expect(syncNotionSkill(repositoryFile, globalFile)).rejects.toThrow(
    "copies differ",
  );
  expect(await readFile(repositoryFile, "utf8")).toBe("repository");
  expect(await readFile(globalFile, "utf8")).toBe("global");
});
test("explicit directions copy the selected source and are idempotent", async () => {
  const { repositoryFile, globalFile } = await files();
  await syncNotionSkill(repositoryFile, globalFile, "--from-global");
  expect(await readFile(repositoryFile, "utf8")).toBe("global");
  await writeFile(repositoryFile, "updated repository");
  await syncNotionSkill(repositoryFile, globalFile, "--to-global");
  expect(await readFile(globalFile, "utf8")).toBe("updated repository");
  expect(await syncNotionSkill(repositoryFile, globalFile, "--to-global")).toBe(
    "Already in sync.",
  );
});
test("missing source leaves destination intact", async () => {
  const { repositoryFile, directory } = await files();
  await expect(
    syncNotionSkill(
      repositoryFile,
      join(directory, "missing.md"),
      "--from-global",
    ),
  ).rejects.toThrow("Selected source does not exist");
  expect(await readFile(repositoryFile, "utf8")).toBe("repository");
});
test("refuses to follow destination symlinks", async () => {
  const { repositoryFile, globalFile, directory } = await files();
  const link = join(directory, "linked.md");
  await symlink(globalFile, link);
  await expect(
    syncNotionSkill(repositoryFile, link, "--to-global"),
  ).rejects.toThrow("Refusing to replace a symlink");
  expect(await readFile(globalFile, "utf8")).toBe("global");
});
