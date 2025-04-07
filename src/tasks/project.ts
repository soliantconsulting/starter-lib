import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { ListrTask } from "listr2";
import type { InputContext } from "../pipeline.js";
import { execute } from "../util.js";

export type ProjectContext = {
    project: {
        name: string;
        path: string;
    };
};

export const createProjectTask = (): ListrTask<Partial<ProjectContext> & InputContext> => ({
    title: "Configure project directory",
    task: async (context, task): Promise<void> => {
        const prompt = task.prompt(ListrEnquirerPromptAdapter);

        const name = await prompt.run<string>({
            type: "input",
            message: "Name:",
            initial: context.input.name,
        });

        const path = join(process.cwd(), name);
        let pathExists = false;

        try {
            await stat(path);
            pathExists = true;
        } catch {
            // Noop
        }

        if (pathExists) {
            throw new Error(`Path ${path} already exists`);
        }

        await mkdir(path);
        await execute(task.stdout(), "git", ["init"], { cwd: path });

        context.project = {
            name,
            path,
        };
    },
});
