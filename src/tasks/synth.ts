import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Liquid } from "liquidjs";
import type { ListrRenderer, ListrTask, ListrTaskWrapper } from "listr2";
import compileWildcardMatch from "wildcard-match";
import { execute, requireContext } from "../util.js";
import type { ProjectContext } from "./project.js";

type WildcardMatch = (path: string) => boolean;
type ExpandContext = {
    basePath: string;
    liquid: Liquid;
    mustIgnore: WildcardMatch;
};

const expandRecursive = async (
    sourcePath: string,
    destinationPath: string,
    context: ExpandContext,
): Promise<void> => {
    const relativePath = relative(context.basePath, sourcePath);

    if (context.mustIgnore(relativePath)) {
        return;
    }

    const stats = await stat(sourcePath);

    if (stats.isDirectory()) {
        await mkdir(destinationPath, { recursive: true });
        const entries = await readdir(sourcePath);

        for (const entry of entries) {
            await expandRecursive(join(sourcePath, entry), join(destinationPath, entry), context);
        }

        return;
    }

    if (sourcePath.endsWith(".liquid")) {
        try {
            await writeFile(
                destinationPath.replace(/\.liquid$/, ""),
                await context.liquid.renderFile(sourcePath),
            );
            return;
        } catch (error) {
            throw new Error(`Failed to render ${sourcePath}: ${error}`);
        }
    }

    await copyFile(sourcePath, destinationPath);
};

export type IgnoreListCreator = (context: unknown) => string[];
export type SynthHook = (
    context: ProjectContext,
    task: ListrTaskWrapper<ProjectContext, typeof ListrRenderer, typeof ListrRenderer>,
) => Promise<void> | void;

export type SynthTaskOptions = {
    postInstall?: SynthHook;
    ignoreList?: IgnoreListCreator;
};

export const createSynthTask = (
    sourcePath: string,
    options?: SynthTaskOptions,
): ListrTask<Partial<ProjectContext>> => ({
    title: "Synth project",
    task: async (context, task) => {
        const projectContext = requireContext(context, "project");
        const ignoreGlobPaths = options?.ignoreList?.(context) ?? [];
        const mustIgnore =
            ignoreGlobPaths.length === 0 ? () => false : compileWildcardMatch(ignoreGlobPaths);

        const liquid = new Liquid({
            globals: context,
            strictFilters: true,
            strictVariables: true,
        });
        await expandRecursive(sourcePath, projectContext.path, {
            basePath: sourcePath,
            liquid,
            mustIgnore,
        });

        await execute(task.stdout(), "pnpm", ["install"], { cwd: projectContext.path });
        await options?.postInstall?.(
            context as ProjectContext,
            task as ListrTaskWrapper<ProjectContext, typeof ListrRenderer, typeof ListrRenderer>,
        );
        await execute(task.stdout(), "pnpm", ["biome", "check", "--write"], {
            cwd: projectContext.path,
        });
    },
});
