/**
 * Lists all JSON contract filenames available in the package.
 */
export declare function listContracts(): string[];

/**
 * Lists all JSON schema validation filenames.
 */
export declare function listSchemas(): string[];

/**
 * Reads and parses a contract or schema JSON file.
 * @param name - Filename with or without `.json` extension (e.g. 'korg_ms2000' or 'hardware_profile.schema.json')
 */
export declare function getContract<T = Record<string, any>>(name: string): T;
