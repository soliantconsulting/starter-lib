import { StackSelectionStrategy, Toolkit } from "@aws-cdk/toolkit-lib";
import { CloudFormation } from "@aws-sdk/client-cloudformation";
import { App } from "aws-cdk-lib/core";
import type { z } from "zod";

export type CreateStack = (app: App, stackName: string) => void;

export const deployStack = async <T extends z.ZodTypeAny>(
    region: string,
    stackName: string,
    createStack: CreateStack,
    outputSchema: T,
): Promise<z.output<T>> => {
    const cdk = new Toolkit();
    const context = await cdk.fromAssemblyBuilder(async () => {
        const app = new App();
        createStack(app, stackName);
        return app.synth();
    });

    await cdk.deploy(context, {
        stacks: {
            strategy: StackSelectionStrategy.ALL_STACKS,
        },
    });

    const cf = new CloudFormation({ region });
    const result = await cf.describeStacks({
        StackName: stackName,
    });

    if (!result.Stacks?.[0]) {
        throw new Error(`Could not locate ${stackName} stack`);
    }

    const stack = result.Stacks[0];
    const outputs: Record<string, string> = {};

    for (const output of stack.Outputs ?? []) {
        if (!(output.OutputKey !== undefined && output.OutputValue !== undefined)) {
            continue;
        }

        outputs[output.OutputKey] = output.OutputValue;
    }

    return outputSchema.parse(outputs);
};
