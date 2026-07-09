const REDACTED = "[REDACTED]";
const SENSITIVE_MARKERS = /(token|secret|password|passwd|api[_-]?key|session|cookie|authorization|localStorage|sessionStorage)/i;

export function redactSensitiveText(value: string, explicitSecrets: string[] = []): string {
  let redacted = value;

  for (const secret of explicitSecrets) {
    if (secret) {
      redacted = redacted.split(secret).join(REDACTED);
    }
  }

  return redacted
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\b(token|secret|password|passwd|api[_-]?key|session|cookie|authorization)\b\s*[:=]\s*["']?[^"',;\s}]+/gi, `$1=${REDACTED}`)
    .replace(/\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
    .slice(0, 4000);
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const [key] of url.searchParams) {
      if (SENSITIVE_MARKERS.test(key)) {
        url.searchParams.set(key, REDACTED);
      }
    }
    return url.toString();
  } catch {
    return redactSensitiveText(value);
  }
}

export function isSensitiveField(input: {
  type?: string | null;
  name?: string | null;
  label?: string | null;
  placeholder?: string | null;
  selector?: string | null;
}): boolean {
  return [
    input.type,
    input.name,
    input.label,
    input.placeholder,
    input.selector,
  ].some((value) => Boolean(value && SENSITIVE_MARKERS.test(value)));
}

export function safeErrorMessage(error: unknown, explicitSecrets: string[] = []): string {
  if (error instanceof Error) {
    return redactSensitiveText(error.message || error.name, explicitSecrets);
  }

  return redactSensitiveText(String(error), explicitSecrets);
}
