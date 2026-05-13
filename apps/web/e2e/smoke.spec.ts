import { expect, test } from "@playwright/test";

test("health endpoint responds", async ({ request }) => {
  const response = await request.get("http://localhost:4000/health");
  expect(response.status()).toBeLessThan(500);
});
