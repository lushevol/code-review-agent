import { SyncRedactor } from "redact-pii";
import type { RootAgentConfig } from "agent-config-manager";

type SensitiveDataMaskConfig = NonNullable<RootAgentConfig["sensitiveDataMask"]>;

let redactor: SyncRedactor | null = null;

function getDefaultRedactor(): SyncRedactor {
  return new SyncRedactor({
    globalReplaceWith: "****",
    builtInRedactors: {
      credentials: { enabled: true },
      password: { enabled: false },
      emailAddress: { enabled: false },
      creditCardNumber: { enabled: false },
      ipAddress: { enabled: false },
      names: { enabled: false },
      phoneNumber: { enabled: false },
      streetAddress: { enabled: false },
      username: { enabled: false },
      usSocialSecurityNumber: { enabled: false },
      zipcode: { enabled: false },
      url: { enabled: false },
      digits: { enabled: false },
    },
    customRedactors: {
      before: [
        {
          replaceWith: "API_KEY",
          regexpPattern: /sk_(live|test)_[a-zA-Z0-9]{24,}/g,
        },
        {
          replaceWith: "TOKEN",
          regexpPattern: /Bearer [a-zA-Z0-9\-._]{30,}/g,
        },
      ],
    },
  });
}

/**
 * Configure the sensitive data mask globally.
 * Call once at startup with the user's config.
 * If never called, the default built-in redactor is used.
 */
export function configureSensitiveDataMask(config?: SensitiveDataMaskConfig): void {
  if (!config || config.enabled === false) {
    redactor = null;
    return;
  }
  const builtInRedactors: Record<string, { enabled: boolean }> = {};
  if (config.redactors?.credentials !== undefined) {
    builtInRedactors.credentials = { enabled: config.redactors.credentials };
  }
  const customBefore: Array<{ replaceWith: string; regexpPattern: RegExp }> = [];
  if (config.customPatterns) {
    for (const cp of config.customPatterns) {
      customBefore.push({
        replaceWith: cp.replaceWith,
        regexpPattern: new RegExp(cp.pattern, "g"),
      });
    }
  }
  if (customBefore.length === 0 && Object.keys(builtInRedactors).length === 0) {
    redactor = null;
    return;
  }
  redactor = new SyncRedactor({
    globalReplaceWith: "****",
    builtInRedactors: Object.keys(builtInRedactors).length > 0
      ? builtInRedactors
      : { credentials: { enabled: true } },
    customRedactors: customBefore.length > 0 ? { before: customBefore } : undefined,
  });
}

export function maskSensitiveData(code: string): string {
  if (!code || typeof code !== "string") {
    return String(code);
  }
  const r = redactor ?? getDefaultRedactor();
  const masked = r.redact(code);
  return masked.replace(
    /(password|token|secret)\s*=\s*["'][^"']+["']/gi,
    '$1="****"',
  );
}
