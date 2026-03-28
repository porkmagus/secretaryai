type ErrorPayload = {
  error?: string;
};

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);
  const payload = (await response.json().catch(() => null)) as (T & ErrorPayload) | null;

  if (!response.ok) {
    throw new Error(
      payload && typeof payload.error === "string" && payload.error.trim().length > 0
        ? payload.error
        : `Request failed with status ${response.status}.`,
    );
  }

  if (payload === null) {
    throw new Error("The server returned an empty response.");
  }

  return payload;
}
