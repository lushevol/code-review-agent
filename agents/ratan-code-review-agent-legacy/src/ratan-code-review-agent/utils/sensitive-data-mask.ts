import { SyncRedactor } from "redact-pii";

// import redactSecrets from "redact-secrets";

// const redact = redactSecrets("****");
const redactor = new SyncRedactor({
  globalReplaceWith: "****",
  builtInRedactors: {
    credentials: {
      enabled: true,
    },
    password: {
      enabled: false,
    },
    emailAddress: {
      enabled: false,
    },
    creditCardNumber: {
      enabled: false,
    },
    ipAddress: {
      enabled: false,
    },
    names: {
      enabled: false,
    },
    phoneNumber: {
      enabled: false,
    },
    streetAddress: {
      enabled: false,
    },
    username: {
      enabled: false,
    },
    usSocialSecurityNumber: {
      enabled: false,
    },
    zipcode: {
      enabled: false,
    },
    url: {
      enabled: false,
    },
    digits: {
      enabled: false,
    },
  },
  customRedactors: {
    before: [
      {
        // Example for Stripe-like API keys
        replaceWith: "API_KEY",
        regexpPattern: /sk_(live|test)_[a-zA-Z0-9]{24,}/g,
      },
      {
        // Example for a generic Bearer token
        replaceWith: "TOKEN",
        regexpPattern: /Bearer [a-zA-Z0-9\-._]{30,}/g,
      },
    ],
  },
});

export function maskSensitiveData(code: string): string {
  if (!code || typeof code !== "string") {
    return String(code);
  }
  const masked = redactor.redact(code);
  return masked.replace(
    /(password|token|secret)\s*=\s*["'][^"']+["']/gi,
    '$1="****"',
  );
}
