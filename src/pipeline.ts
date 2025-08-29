import { Listr, ListrLogger, ListrLogLevels, type ListrTask } from "listr2";
import meow from "meow";

export type PipelineConfig = {
    packageName: string;
    tasks: ListrTask[];
    baseContext?: Record<string, unknown>;
};

const createCli = (packageName: string) =>
    meow(
        `
  Usage

    $ pnpm dlx ${packageName} [<name>]
`,
        {
            booleanDefault: undefined,
            importMeta: import.meta,
        },
    );

export type InputContext = {
    input: {
        name?: string;
    };
};

export const runPipeline = async (config: PipelineConfig) => {
    const cli = createCli(config.packageName);
    const name = cli.input.at(0);
    const logger = new ListrLogger();

    const tasks = new Listr(config.tasks, { concurrent: false });

    try {
        await tasks.run({
            input: {
                name,
            },
            ...config.baseContext,
        });

        logger.log(ListrLogLevels.COMPLETED, "Project creation successful.");
    } catch (error) {
        logger.log(ListrLogLevels.FAILED, error as string);
    }
};
