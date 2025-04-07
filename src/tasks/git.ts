import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { ListrTask } from "listr2";
import { execute, requireContext } from "../util.js";
import type { BitbucketRepositoryContext } from "./bitbucket-repository.js";
import type { ProjectContext } from "./project.js";

export const createGitTask = (): ListrTask<
    Partial<ProjectContext & BitbucketRepositoryContext>
> => ({
    title: "Initialize Git",
    task: async (context, task): Promise<void> => {
        const projectContext = requireContext(context, "project");
        const bitbucketContext = requireContext(context, "bitbucketRepository");

        if (!bitbucketContext) {
            task.skip("Bitbucket repository disabled");
            return;
        }

        await execute(
            task.stdout(),
            "git",
            [
                "remote",
                "add",
                "origin",
                `git@bitbucket.org:${bitbucketContext.workspace}/${bitbucketContext.repository}.git`,
            ],
            { cwd: projectContext.path },
        );

        const prompt = task.prompt(ListrEnquirerPromptAdapter);
        const initGit = await prompt.run<boolean>({
            type: "toggle",
            message: "Create and push initial commit?",
            initial: true,
        });

        if (!initGit) {
            task.skip("Git repository not initialized");
            return;
        }

        await execute(task.stdout(), "git", ["add", "."], { cwd: projectContext.path });
        await execute(task.stdout(), "git", ["commit", "-m", '"feat: initial commit"'], {
            cwd: projectContext.path,
        });

        let forcePush = false;

        try {
            await execute(task.stdout(), "git", ["push", "-u", "origin", "main"], {
                cwd: projectContext.path,
            });
        } catch {
            forcePush = await task.prompt(ListrEnquirerPromptAdapter).run<boolean>({
                type: "toggle",
                message: "Push failed, try force push?",
                initial: false,
            });
        }

        if (forcePush) {
            await execute(task.stdout(), "git", ["push", "-fu", "origin", "main"], {
                cwd: projectContext.path,
            });
        }
    },
});
