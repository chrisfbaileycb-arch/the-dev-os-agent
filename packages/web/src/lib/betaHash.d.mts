export const BETA_SALT: string;
export const BETA_ITERATIONS: number;
export const BETA_DEV_PASSCODE: string;
export function deriveBetaHash(passcode: string): Promise<string>;
