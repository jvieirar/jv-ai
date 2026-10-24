import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

type Direction = "--check" | "--from-global" | "--to-global";

export async function syncNotionSkill(
  repositoryFile: string,
  globalFile: string,
  direction: Direction = "--check",
) {
  if (resolve(repositoryFile) === resolve(globalFile))
    throw new Error("Files must be distinct.");
  const read = async (path: string): Promise<Buffer | null> => {
    try {
      if ((await lstat(path)).isSymbolicLink())
        throw new Error(`Refusing to replace a symlink: ${path}`);
      return await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  };
  const repository = await read(repositoryFile);
  const global = await read(globalFile);
  if (repository && global && repository.equals(global))
    return "Already in sync.";
  if (direction === "--check")
    throw new Error(
      "jv-notion copies differ or one is missing. Inspect the diff, then use --from-global or --to-global explicitly.",
    );
  const source = direction === "--from-global" ? global : repository;
  const destination =
    direction === "--from-global" ? repositoryFile : globalFile;
  if (!source)
    throw new Error("Selected source does not exist; nothing was changed.");
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, source);
  if (!(await readFile(destination)).equals(source))
    throw new Error("Written skill failed verification.");
  return `Synchronized ${destination}`;
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2).filter((arg) => arg !== "--");
    const direction = args[0] ?? "--check";
    if (
      args.length > 1 ||
      !["--check", "--from-global", "--to-global"].includes(direction)
    )
      throw new Error(
        "Usage: bun run sync-notion-skill [--check|--from-global|--to-global]",
      );
    console.log(
      await syncNotionSkill(
        resolve(import.meta.dir, "../skills/jv-notion/SKILL.md"),
        resolve(homedir(), ".agents/skills/jv-notion/SKILL.md"),
        direction as Direction,
      ),
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
