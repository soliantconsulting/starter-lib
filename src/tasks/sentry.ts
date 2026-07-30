import { setTimeout as sleep } from "node:timers/promises";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { ListrTask } from "listr2";
import open from "open";
import { z } from "zod";
import { requireContext } from "../util.js";
import type { ProjectContext } from "./project.js";

const sentryUrl = "https://sentry.io/";
// Matches the server-side wizard hash cache TTL.
const loginTimeoutMs = 600_000;
const pollIntervalMs = 2_000;

const hashResponseSchema = z.object({
    hash: z.string(),
});

const wizardDataSchema = z.object({
    apiKeys: z.object({
        id: z.string(),
        token: z.string(),
    }),
    projects: z
        .array(
            z.object({
                slug: z.string(),
                organization: z.object({
                    slug: z.string(),
                }),
                keys: z
                    .array(
                        z.object({
                            dsn: z.object({
                                public: z.string(),
                            }),
                        }),
                    )
                    .min(1),
            }),
        )
        .min(1),
});

type WizardData = z.output<typeof wizardDataSchema>;

export type SentryContext = {
    sentry: {
        org: string;
        projectSlug: string;
        dsn: string;
        authToken: string;
        authTokenId: string;
    } | null;
};

export type SentryTaskOptions = {
    defaultOrgSlug?: string;
    projectPlatform?: string;
    disallowSkip?: boolean;
};

const fetchWizardHash = async (): Promise<string> => {
    const response = await fetch(`${sentryUrl}api/0/wizard/`);

    if (!response.ok) {
        throw new Error(`Failed to start Sentry login: ${response.status}`);
    }

    return hashResponseSchema.parse(await response.json()).hash;
};

const pollWizardData = async (hash: string): Promise<WizardData> => {
    const timeoutAt = Date.now() + loginTimeoutMs;

    while (Date.now() < timeoutAt) {
        let response: Response | null;

        try {
            response = await fetch(`${sentryUrl}api/0/wizard/${hash}/`);
        } catch {
            // Transient network error; keep polling until the deadline.
            response = null;
        }

        if (response?.ok) {
            return wizardDataSchema.parse(await response.json());
        }

        if (response?.status === 404) {
            throw new Error("Sentry login link expired");
        }

        await sleep(pollIntervalMs);
    }

    throw new Error("Sentry login timed out");
};

type WizardLoginInput = {
    orgSlug: string;
    projectSlug: string;
    projectPlatform?: string;
    reportLoginUrl: (url: string) => void;
    confirmRetry: (message: string) => Promise<boolean>;
};

const runWizardLogin = async (input: WizardLoginInput): Promise<WizardData> => {
    while (true) {
        const hash = await fetchWizardHash();
        const loginUrl = new URL(`${sentryUrl}account/settings/wizard/${hash}/`);
        loginUrl.searchParams.set("org_slug", input.orgSlug);
        loginUrl.searchParams.set("project_slug", input.projectSlug);

        if (input.projectPlatform) {
            loginUrl.searchParams.set("project_platform", input.projectPlatform);
        }

        input.reportLoginUrl(loginUrl.toString());
        await open(loginUrl.toString()).catch(() => {
            // Browser-less environments; the URL is shown in the task output.
        });

        try {
            return await pollWizardData(hash);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Sentry login failed";

            if (!(await input.confirmRetry(message))) {
                throw error;
            }
        } finally {
            void fetch(`${sentryUrl}api/0/wizard/${hash}/`, { method: "DELETE" }).catch(() => {
                // The hash cache expires on its own.
            });
        }
    }
};

export const createSentryTask = (
    options?: SentryTaskOptions,
): ListrTask<Partial<SentryContext & ProjectContext>> => ({
    title: "Configure Sentry",
    rendererOptions: {
        persistentOutput: true,
        outputBar: Number.POSITIVE_INFINITY,
    },
    task: async (context, task): Promise<void> => {
        const prompt = task.prompt(ListrEnquirerPromptAdapter);
        const project = requireContext(context, "project");

        if (!options?.disallowSkip) {
            const configureSentry = await prompt.run<boolean>({
                type: "toggle",
                message: "Use Sentry?",
                initial: true,
            });

            if (!configureSentry) {
                context.sentry = null;
                task.skip("Sentry not configured");
                return;
            }
        }

        const orgSlug = await prompt.run<string>({
            type: "input",
            message: "Sentry organization slug:",
            initial: options?.defaultOrgSlug ?? "soliant-consulting-inc",
        });

        const wizardData = await runWizardLogin({
            orgSlug,
            projectSlug: project.name,
            projectPlatform: options?.projectPlatform,
            reportLoginUrl: (url) => {
                task.output = `Log in via browser to select or create the project:\n${url}`;
            },
            confirmRetry: async (message) =>
                prompt.run<boolean>({
                    type: "toggle",
                    message: `${message}. Retry?`,
                    initial: true,
                }),
        });

        let selectedProject = wizardData.projects[0];

        if (wizardData.projects.length > 1) {
            const selectedSlug = await prompt.run<string>({
                type: "select",
                message: "Sentry project:",
                choices: wizardData.projects.map((wizardProject) => wizardProject.slug),
            });

            selectedProject =
                wizardData.projects.find((wizardProject) => wizardProject.slug === selectedSlug) ??
                selectedProject;
        }

        context.sentry = {
            org: selectedProject.organization.slug,
            projectSlug: selectedProject.slug,
            dsn: selectedProject.keys[0].dsn.public,
            authToken: wizardData.apiKeys.token,
            authTokenId: wizardData.apiKeys.id,
        };

        task.output = `Auth token created; rename it to "${project.name}" if desired:\nhttps://${selectedProject.organization.slug}.sentry.io/settings/auth-tokens/${wizardData.apiKeys.id}/`;
    },
});
