import { BootstrapEnvironments, Toolkit } from "@aws-cdk/toolkit-lib";
import { STS } from "@aws-sdk/client-sts";
import type { GetCallerIdentityResponse } from "@aws-sdk/client-sts/dist-types/models/models_0.js";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { ListrTask } from "listr2";

export type AwsEnvContext = {
    awsEnv: {
        accountId: string;
        region: string;
    } | null;
};

export type AwsEnvTaskOptions = {
    disallowSkip?: boolean;
};

export const createAwsEnvTask = (
    options?: AwsEnvTaskOptions,
): ListrTask<Partial<AwsEnvContext>> => ({
    title: "Configure AWS environment",
    task: async (context, task): Promise<void> => {
        const prompt = task.prompt(ListrEnquirerPromptAdapter);

        if (!options?.disallowSkip) {
            const configureAws = await task.prompt(ListrEnquirerPromptAdapter).run<boolean>({
                type: "toggle",
                message: "Use AWS environment?",
                initial: true,
            });

            if (!configureAws) {
                context.awsEnv = null;
                task.skip("AWS environment not configured");
                return;
            }
        }

        const sts = new STS({ region: "us-east-1" });
        let identity: GetCallerIdentityResponse;

        try {
            identity = await sts.getCallerIdentity({});
        } catch (error) {
            throw new Error("Could not acquire account ID, have you set up AWS env variables?");
        }

        if (!identity.Account) {
            throw new Error("Failed to acquire account ID from identity");
        }

        const region = await prompt.run<string>({
            type: "input",
            message: "AWS region:",
            initial: "us-east-1",
        });

        const cdk = new Toolkit();
        await cdk.bootstrap(
            BootstrapEnvironments.fromList([`aws://${identity.Account}/${region}`]),
            {},
        );

        context.awsEnv = {
            accountId: identity.Account,
            region,
        };
    },
});
