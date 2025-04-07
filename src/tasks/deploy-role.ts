import type { ListrTask } from "listr2";
import { execute, requireContext } from "../util.js";
import type { AwsEnvContext } from "./aws-env.js";
import type { BitbucketRepositoryContext } from "./bitbucket-repository.js";
import type { ProjectContext } from "./project.js";

export type DeployRoleContext = {
    deployRole: {
        arn: string;
    } | null;
};

export const createDeployRoleTask = (): ListrTask<
    Partial<AwsEnvContext & ProjectContext & BitbucketRepositoryContext & DeployRoleContext>
> => ({
    title: "Setup deployment role",
    task: async (context, task): Promise<void> => {
        const awsEnvContext = requireContext(context, "awsEnv");
        const bitbucketContext = requireContext(context, "bitbucketRepository");

        if (awsEnvContext === null) {
            context.deployRole = null;
            task.skip("AWS environment disabled");
            return;
        }

        if (!bitbucketContext) {
            context.deployRole = null;
            task.skip("Bitbucket repository disabled");
            return;
        }

        const projectContext = requireContext(context, "project");

        await execute(
            task.stdout(),
            "pnpm",
            [
                "dlx",
                "@soliantconsulting/bitbucket-openid-connect@^1",
                "deploy",
                "bitbucket-openid-connect",
                projectContext.name,
                bitbucketContext.repositoryUuid,
            ],
            {
                env: {
                    AWS_REGION: awsEnvContext.region,
                },
            },
        );

        const result = await execute(
            task.stdout(),
            "pnpm",
            [
                "dlx",
                "@soliantconsulting/bitbucket-openid-connect@^1",
                "get-role-arn",
                "bitbucket-openid-connect",
                projectContext.name,
            ],
            {
                env: {
                    AWS_REGION: awsEnvContext.region,
                },
            },
        );

        context.deployRole = { arn: result.stdout };
    },
});
