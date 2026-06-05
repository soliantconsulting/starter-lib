import type { ListrTask } from "listr2";
import semver from "semver/preload.js";
import { type ExecuteResult, execute } from "../util.js";

export const createNodeVersionTask = (minVersion: string): ListrTask<unknown> => ({
    title: "Check node version",
    task: async (_context, task): Promise<void> => {
        let result: ExecuteResult;

        try {
            result = await execute(task.stdout(), "node", ["--version"]);
        } catch {
            throw new Error("node not found, please install latest version: https://nodejs.org");
        }

        const version = result.stdout.trim().replace(/^v/, "");

        if (!semver.gte(version, minVersion)) {
            throw new Error(`node version ${version} found, need at least ${minVersion}`);
        }
    },
});
