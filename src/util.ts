import { execa, type Options, type Result } from "execa";

export type ExecuteResult = Result<{ encoding: "utf8" }>;

export const execute = async (
    stdout: NodeJS.WritableStream | null,
    file: string,
    args: readonly string[],
    options?: Options,
): Promise<ExecuteResult> => {
    const execute = execa(file, args, options);

    if (stdout) {
        execute.stdout?.pipe(stdout);
        execute.stderr?.pipe(stdout);
    }

    return (await execute) as ExecuteResult;
};

export type NotUndefined<T> = T extends undefined ? never : T;

export const requireContext = <T extends object, K extends keyof T & string>(
    context: T,
    name: K,
): NotUndefined<T[K]> => {
    if (context[name] === undefined) {
        throw new Error(`Context is missing child with name ${name}`);
    }

    return context[name] as NotUndefined<T[K]>;
};
