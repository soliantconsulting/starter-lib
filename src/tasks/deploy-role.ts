import { BootstrapEnvironments, Toolkit } from "@aws-cdk/toolkit-lib";
import { CloudFormation } from "@aws-sdk/client-cloudformation";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import {
    type Conditions,
    ManagedPolicy,
    OpenIdConnectProvider,
    Role,
    WebIdentityPrincipal,
} from "aws-cdk-lib/aws-iam";
import { App } from "aws-cdk-lib/core";
import type { Construct } from "constructs";
import type { ListrTask } from "listr2";
import { requireContext } from "../util.js";
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
        const prompt = task.prompt(ListrEnquirerPromptAdapter);

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

        const region = await prompt.run<string>({
            type: "input",
            message: "AWS deploy role region:",
            footer: "Keep this as us-east-1 unless you deployed a previous deploy role in another region",
            initial: "us-east-1",
        });

        const toolkit = new Toolkit();

        if (region !== awsEnvContext.region) {
            await toolkit.bootstrap(
                BootstrapEnvironments.fromList([`aws://${awsEnvContext.accountId}/${region}`]),
                {},
            );
        }

        await toolkit.deploy(
            await toolkit.fromAssemblyBuilder(async () => {
                const app = new App();

                const baseProps = {
                    region,
                    bitbucketDomain:
                        "api.bitbucket.org/2.0/workspaces/soliantconsulting/pipelines-config/identity/oidc",
                    bitbucketAudience:
                        "ari:cloud:bitbucket::workspace/edf547a3-8e06-4217-abd8-7b9139a21e2c",
                };

                const providerStack = new ProviderStack(
                    app,
                    "bitbucket-openid-connect-provider",
                    baseProps,
                );

                new RoleStack(app, `bitbucket-openid-connect-role-${projectContext.name}`, {
                    ...baseProps,
                    repositoryUuid: bitbucketContext.repositoryUuid,
                    providerStack,
                });

                return app.synth();
            }),
        );

        const deployRoleArn = await getDeployRoleArn(projectContext.name);
        context.deployRole = { arn: deployRoleArn };
    },
});

const getDeployRoleArn = async (repositoryName: string): Promise<string> => {
    const cf = new CloudFormation();
    const result = await cf.describeStacks({
        StackName: `bitbucket-openid-connect-role-${repositoryName}`,
    });

    if (!result.Stacks?.[0]) {
        throw new Error(`Could not locate bitbucket-openid-connect-role-${repositoryName} stack`);
    }

    const stack = result.Stacks[0];
    const output = stack.Outputs?.find((output) => output.OutputKey === "RoleArn");

    if (!output?.OutputValue) {
        throw new Error("Could not find RoleArn output");
    }

    return output.OutputValue;
};

type ProviderStackProps = StackProps & {
    readonly bitbucketAudience: string;
    readonly bitbucketDomain: string;
};

export class ProviderStack extends Stack {
    public readonly provider: OpenIdConnectProvider;

    public constructor(scope: Construct, id: string, props: ProviderStackProps) {
        super(scope, id, props);

        this.provider = new OpenIdConnectProvider(this, "BitbucketProvider", {
            url: `https://${props.bitbucketDomain}`,
            clientIds: [props.bitbucketAudience],
        });
    }
}

type BitbucketStackProps = StackProps & {
    readonly repositoryUuid: string;
    readonly bitbucketAudience: string;
    readonly bitbucketDomain: string;
    readonly providerStack: ProviderStack;
};

export class RoleStack extends Stack {
    public constructor(scope: Construct, id: string, props: BitbucketStackProps) {
        super(scope, id, props);

        const conditions: Conditions = {
            StringEquals: {
                [`${props.bitbucketDomain}:aud`]: props.bitbucketAudience,
            },
            StringLike: {
                [`${props.bitbucketDomain}:sub`]: `${props.repositoryUuid}:*`,
            },
        };

        const role = new Role(this, "BitbucketDeployRole", {
            assumedBy: new WebIdentityPrincipal(
                props.providerStack.provider.openIdConnectProviderArn,
                conditions,
            ),
            managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess")],
            description:
                "This role is used via Bitbucket pipelines to deploy with AWS CDK or Terraform on the customers AWS account",
            maxSessionDuration: Duration.hours(2),
        });

        new CfnOutput(this, "RoleArn", {
            value: role.roleArn,
        });
    }
}
