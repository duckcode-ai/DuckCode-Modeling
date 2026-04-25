/* Playwright global setup — clone jaffle-shop DataLex once, reuse everywhere.
 *
 * Cloning on every test would hammer GitHub and burn CI minutes. We
 * clone once into `test-results/jaffle-shop/` (outside the package so
 * Vite doesn't watch it) and skip re-cloning if the checkout looks
 * intact. Tests read the cached path via process.env.JAFFLE_SHOP_DIR.
 *
 * Fails loud when offline — the suite relies on the real example repo
 * as the fixture. Set OFFLINE=1 to skip the whole E2E suite in that
 * environment instead of trying to shim the data.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const JAFFLE_URL = "https://github.com/duckcode-ai/jaffle-shop-DataLex.git";
const JAFFLE_REF = process.env.JAFFLE_SHOP_REF || "main";

export default async function globalSetup() {
  const cacheRoot = resolve(process.cwd(), "test-results");
  const dir = join(cacheRoot, "jaffle-shop");

  mkdirSync(cacheRoot, { recursive: true });

  const alreadyCloned =
    existsSync(join(dir, "dbt_project.yml")) && existsSync(join(dir, ".git"));

  if (!alreadyCloned) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    console.log(`[e2e] cloning ${JAFFLE_URL}@${JAFFLE_REF} → ${dir}`);
    try {
      execSync(
        `git clone --depth 1 --branch ${JAFFLE_REF} ${JAFFLE_URL} "${dir}"`,
        { stdio: "inherit" }
      );
    } catch (err) {
      throw new Error(
        `Failed to clone jaffle-shop DataLex. Set OFFLINE=1 to skip E2E, or check network / GitHub access.\n${err.message}`
      );
    }
  } else {
    console.log(`[e2e] reusing cached jaffle-shop at ${dir}`);
  }

  process.env.JAFFLE_SHOP_DIR = dir;
  process.env.JAFFLE_SHOP_URL = JAFFLE_URL;
  process.env.JAFFLE_SHOP_REF = JAFFLE_REF;
}
