import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import { getAccessToken } from "@soliantconsulting/bitbucket-cloud-cli-auth";
import type { ListrTask } from "listr2";
import { BitBucketClient } from "../bitbucket.js";

export type BitbucketRepositoryContext = {
    bitbucketRepository: {
        accessToken: string;
        workspace: string;
        repository: string;
        repositoryUuid: string;
    } | null;
};

export type BitbucketRepositoryTaskOptions = {
    disallowSkip?: boolean;
};

export const createBitbucketRepositoryTask = (
    options?: BitbucketRepositoryTaskOptions,
): ListrTask<Partial<BitbucketRepositoryContext>> => ({
    title: "Configure Bitbucket repository",
    task: async (context, task): Promise<void> => {
        const prompt = task.prompt(ListrEnquirerPromptAdapter);

        if (!options?.disallowSkip) {
            const configureBitbucket = await task.prompt(ListrEnquirerPromptAdapter).run<boolean>({
                type: "toggle",
                message: "Use Bitbucket?",
                initial: true,
            });

            if (!configureBitbucket) {
                context.bitbucketRepository = null;
                task.skip("Bitbucket repository not configured");
                return;
            }
        }

        const repositoryClonePrompt = await prompt.run<string>({
            type: "input",
            message: "Repository clone prompt:",
        });

        const repositoryMatch = repositoryClonePrompt.match(
            /@bitbucket\.org[:\/]([^\/]+)\/(.+)\.git/,
        );

        if (!repositoryMatch) {
            throw new Error("Invalid repository clone prompt");
        }

        const [, workspace, repository] = repositoryMatch;

        const accessToken = await getAccessToken("knXh7CKqDtCUHLrhVW", 31337);

        const bitbucket = new BitBucketClient(accessToken, workspace, repository);
        const repositoryUuid = await bitbucket.getRepositoryUuid();
        await bitbucket.enablePipeline();

        context.bitbucketRepository = {
            accessToken,
            workspace,
            repository,
            repositoryUuid,
        };
    },
});
