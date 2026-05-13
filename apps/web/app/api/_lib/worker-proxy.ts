import { NextResponse } from "next/server";

const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";

type WorkerJsonProxyOptions = {
  body?: unknown;
  cache?: RequestCache;
  headers?: HeadersInit;
  method?: string;
  query?: Record<string, string | null | undefined>;
  successStatus?: number;
  timeoutMs?: number;
  unavailableMessage?: string;
};

export function workerUrl(path: string) {
  return `${workerBaseUrl}${path}`;
}

export async function proxyWorkerJson<T>(
  path: string,
  {
    body,
    cache = "no-store",
    headers,
    method = "GET",
    query,
    successStatus,
    timeoutMs,
    unavailableMessage = "Worker is unavailable.",
  }: WorkerJsonProxyOptions = {},
) {
  const controller = timeoutMs ? new AbortController() : undefined;
  const timeout = timeoutMs ? setTimeout(() => controller?.abort(), timeoutMs) : undefined;

  try {
    const upstreamUrl = new URL(workerUrl(path));

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value) {
          upstreamUrl.searchParams.set(key, value);
        }
      }
    }

    const isJsonBody = body !== undefined && typeof body !== "string";
    const response = await fetch(upstreamUrl, {
      method,
      cache,
      headers: isJsonBody
        ? {
            "Content-Type": "application/json",
            ...headers,
          }
        : headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      signal: controller?.signal,
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(payload ?? { error: "Worker request failed." }, {
        status: response.status,
      });
    }

    return NextResponse.json(payload as T, {
      status: successStatus ?? response.status,
    });
  } catch {
    return NextResponse.json({ error: unavailableMessage }, { status: 503 });
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

type WorkerBinaryProxyOptions = {
  cache?: RequestCache;
  headers?: HeadersInit;
  method?: string;
  mimeType?: string;
  query?: Record<string, string | null | undefined>;
  timeoutMs?: number;
  unavailableMessage?: string;
};

export async function proxyWorkerBinary(
  path: string,
  {
    cache = "no-store",
    headers,
    method = "GET",
    mimeType,
    query,
    timeoutMs,
    unavailableMessage = "Worker is unavailable.",
  }: WorkerBinaryProxyOptions = {},
) {
  const controller = timeoutMs ? new AbortController() : undefined;
  const timeout = timeoutMs ? setTimeout(() => controller?.abort(), timeoutMs) : undefined;

  try {
    const upstreamUrl = new URL(workerUrl(path));

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value) {
          upstreamUrl.searchParams.set(key, value);
        }
      }
    }

    const response = await fetch(upstreamUrl, {
      method,
      cache,
      headers,
      signal: controller?.signal,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      return NextResponse.json(payload ?? { error: "Worker request failed." }, {
        status: response.status,
      });
    }

    return new NextResponse(await response.arrayBuffer(), {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") ?? mimeType ?? "application/octet-stream",
      },
    });
  } catch {
    return NextResponse.json({ error: unavailableMessage }, { status: 503 });
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

type WorkerFormDataProxyOptions = {
  cache?: RequestCache;
  fieldName?: string;
  fileRequiredMessage: string;
  method?: string;
  successStatus?: number;
  unavailableMessage?: string;
};

export async function proxyWorkerFormDataJson<T>(
  request: Request,
  path: string,
  {
    cache = "no-store",
    fieldName = "file",
    fileRequiredMessage,
    method = "POST",
    successStatus,
    unavailableMessage = "Worker is unavailable.",
  }: WorkerFormDataProxyOptions,
) {
  try {
    const incoming = await request.formData();
    const file = incoming.get(fieldName);

    if (!(file instanceof File)) {
      return NextResponse.json({ error: fileRequiredMessage }, { status: 400 });
    }

    const form = new FormData();
    form.set(fieldName, file, file.name);

    const response = await fetch(workerUrl(path), {
      method,
      body: form,
      cache,
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(payload ?? { error: "Worker request failed." }, {
        status: response.status,
      });
    }

    return NextResponse.json(payload as T, {
      status: successStatus ?? response.status,
    });
  } catch {
    return NextResponse.json({ error: unavailableMessage }, { status: 503 });
  }
}
