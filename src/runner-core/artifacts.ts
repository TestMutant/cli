import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import type { RunnerArtifactReference } from "./runner-contracts";

export function resolveArtifactDirectory(
  artifactRoot: string,
  sessionId: string,
  requestedDirectory?: string | null,
): string {
  const root = resolve(artifactRoot);
  const fallback = resolve(root, sessionId);

  if (!requestedDirectory?.trim()) {
    return fallback;
  }

  const requested = isAbsolute(requestedDirectory)
    ? resolve(requestedDirectory)
    : resolve(root, requestedDirectory);

  return isSubpath(root, requested) ? requested : fallback;
}

export async function writeArtifact(
  artifactDirectory: string,
  kind: string,
  preferredFileName: string,
  contentType: string,
  data: Buffer,
): Promise<RunnerArtifactReference> {
  await mkdir(artifactDirectory, { recursive: true });
  const fileName = safeFileName(preferredFileName, defaultExtension(contentType));
  const path = join(artifactDirectory, fileName);
  await writeFile(path, data);
  const sizeBytes = (await stat(path)).size;

  return {
    kind,
    path,
    fileName,
    contentType,
    sizeBytes,
  };
}

export function safeFileName(value: string | null | undefined, extension: string): string {
  const candidate = basename(value?.trim() || `artifact-${Date.now()}${extension}`);
  const sanitized = candidate.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 128);
  return sanitized || `artifact-${Date.now()}${extension}`;
}

export function artifactKindFromAttachment(name: "screenshot" | "trace" | "video"): {
  kind: string;
  extension: string;
  contentType: string;
} {
  if (name === "trace") {
    return { kind: "trace", extension: ".zip", contentType: "application/zip" };
  }

  if (name === "video") {
    return { kind: "video", extension: ".webm", contentType: "video/webm" };
  }

  return { kind: "screenshot", extension: ".png", contentType: "image/png" };
}

function defaultExtension(contentType: string): string {
  if (contentType === "image/png") {
    return ".png";
  }
  if (contentType === "application/zip") {
    return ".zip";
  }
  if (contentType === "video/webm") {
    return ".webm";
  }
  return extname(contentType) || ".bin";
}

function isSubpath(parent: string, child: string): boolean {
  const normalizedParent = parent.endsWith("\\") ? parent : `${parent}\\`;
  return child === parent || child.startsWith(normalizedParent);
}
