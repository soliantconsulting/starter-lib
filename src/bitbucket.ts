import { z } from "zod";

const BASE_URL = "https://api.bitbucket.org/2.0";

type GetRepositoryResponse = {
    uuid: string;
};

type GetEnvironmentsResponse = {
    values: {
        type: string;
        uuid: string;
        name: string;
    }[];
};

export type Environment = {
    uuid: string;
    type: string;
    name: string;
};

export class BitBucketClient {
    public constructor(
        private readonly accessToken: string,
        private readonly workspace: string,
        private readonly repoSlug: string,
    ) {
        // Intentionally left empty
    }

    public async getRepositoryUuid(): Promise<string> {
        const response = await fetch(
            `${BASE_URL}/repositories/${this.workspace}/${this.repoSlug}`,
            {
                headers: {
                    authorization: `Bearer ${this.accessToken}`,
                },
            },
        );

        if (!response.ok) {
            throw new Error("Failed to fetch repository");
        }

        const body = (await response.json()) as GetRepositoryResponse;
        return body.uuid;
    }

    public async enablePipeline(): Promise<void> {
        const response = await fetch(
            `${BASE_URL}/repositories/${this.workspace}/${this.repoSlug}/pipelines_config`,
            {
                method: "PUT",
                headers: {
                    authorization: `Bearer ${this.accessToken}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    enabled: true,
                }),
            },
        );

        if (!response.ok) {
            throw new Error("Failed to enable pipeline");
        }
    }

    public async getEnvironments(): Promise<Environment[]> {
        const response = await fetch(
            `${BASE_URL}/repositories/${this.workspace}/${this.repoSlug}/environments`,
            {
                headers: {
                    authorization: `Bearer ${this.accessToken}`,
                },
            },
        );

        if (!response.ok) {
            throw new Error("Failed to fetch environments");
        }

        const body = (await response.json()) as GetEnvironmentsResponse;

        return body.values.map((value) => ({
            uuid: value.uuid,
            type: value.type,
            name: value.name,
        }));
    }

    /**
     * Returns a BitBucketVariables instance for the given environment UUID.
     *
     * If no environment UUID is provided, the variables for the repository are returned.
     */
    public variables(envUuid: string | null = null): BitBucketVariables {
        return new BitBucketVariables(this, envUuid);
    }

    /**
     * @internal
     */
    public async createVariable(
        envUuid: string | null,
        key: string,
        value: string,
        secured: boolean,
    ): Promise<void> {
        const response = await fetch(this.getVariableBaseUrl(envUuid), {
            method: "POST",
            headers: {
                authorization: `Bearer ${this.accessToken}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({ key, value, secured }),
        });

        if (!response.ok) {
            throw new Error(`Failed to create ${key} variable`);
        }
    }

    /**
     * @internal
     */
    public async updateVariable(
        envUuid: string | null,
        id: string,
        key: string,
        value: string,
        secured: boolean,
    ): Promise<void> {
        const response = await fetch(`${this.getVariableBaseUrl(envUuid)}${id}`, {
            method: "PUT",
            headers: {
                authorization: `Bearer ${this.accessToken}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({ key, value, secured }),
        });

        if (!response.ok) {
            throw new Error(`Failed to update ${key} variable`);
        }
    }

    /**
     * @internal
     */
    public async listVariables(envUuid: string | null): Promise<Variables> {
        const variables: Variables = new Map();
        let nextUrl: string | null = this.getVariableBaseUrl(envUuid);

        while (nextUrl !== null) {
            const response = await fetch(nextUrl, {
                headers: {
                    authorization: `Bearer ${this.accessToken}`,
                },
            });

            if (!response.ok) {
                throw new Error("Failed to fetch repository variables");
            }

            const body = variablePageSchema.parse(await response.json());
            nextUrl = body.next ?? null;

            for (const variable of body.values) {
                variables.set(variable.key, variable.uuid);
            }
        }

        return variables;
    }

    private getVariableBaseUrl(envUuid: string | null) {
        return envUuid === null
            ? `${BASE_URL}/repositories/${this.workspace}/${this.repoSlug}/pipelines_config/variables/`
            : `${BASE_URL}/repositories/${this.workspace}/${this.repoSlug}/deployments_config/environments/${envUuid}/variables/`;
    }
}

type Variables = Map<string, string>;

const variablePageSchema = z.object({
    values: z.array(
        z.object({
            uuid: z.string(),
            key: z.string(),
        }),
    ),
    next: z.url().optional(),
});

export class BitBucketVariables {
    private readonly client: BitBucketClient;
    private readonly envUuid: string | null;
    private variables: Promise<Variables> | null = null;

    public constructor(client: BitBucketClient, envUuid: string | null) {
        this.client = client;
        this.envUuid = envUuid;
    }

    public async replace(key: string, value: string, secured: boolean) {
        const variables = await this.getVariables();
        const uuid = variables.get(key);

        if (uuid) {
            await this.client.updateVariable(this.envUuid, uuid, key, value, secured);
        } else {
            await this.client.createVariable(this.envUuid, key, value, secured);
        }
    }

    private async getVariables(): Promise<Variables> {
        if (this.variables) {
            return this.variables;
        }

        const promise = this.client.listVariables(this.envUuid);
        this.variables = promise;
        return promise;
    }
}
