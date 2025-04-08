import type { ListrTask } from "listr2";
import semver from "semver/preload.js";
import { type ExecuteResult, execute } from "../util.js";

export const createPnpmVersionTask = (minVersion: string): ListrTask<unknown> => ({
    title: "Check pnpm version",
    task: async (_context, task): Promise<void> => {
        let result: ExecuteResult;

        try {
            result = await execute(task.stdout(), "pnpm", ["--version"]);
        } catch {
            throw new Error(
                "pnpm not found, please install latest version: https://pnpm.io/installation",
            );
        }

        const version = result.stdout.trim();

        if (!semver.gte(version, "10.0.0")) {
            throw new Error(`pnpm version ${version} found, need at least 10.0.0`);
        }
    },
});
