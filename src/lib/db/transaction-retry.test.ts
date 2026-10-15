import { afterEach, expect, it, vi } from "vitest";
import { OPERATION_MAX_ATTEMPTS, OPERATION_RETRY_MIN_DELAY_MS, OPERATION_RETRY_MAX_DELAY_MS } from "@/config/operations";
import { isRetryableTransactionError, retryTransaction, transactionRetryDelayMs } from "./transaction-retry";

afterEach(() => vi.restoreAllMocks());

it.each(["40P01", "40001", "55P03"])("retries direct and wrapped %s transaction failures", async code => {
  expect(isRetryableTransactionError({ code })).toBe(true);
  expect(isRetryableTransactionError(new Error("query failed", { cause: { code } }))).toBe(true);
  const attempt = vi.fn().mockRejectedValueOnce({ cause: { code } }).mockResolvedValue("saved");
  await expect(retryTransaction(attempt)).resolves.toBe("saved");
  expect(attempt).toHaveBeenCalledTimes(2);
});

it.each([undefined, null, new Error("failure"), { code: "23505" }, { code: "57014" }])("propagates non-retryable failures (%s)", async failure => {
  expect(isRetryableTransactionError(failure)).toBe(false);
  const attempt = vi.fn().mockRejectedValue(failure);
  await expect(retryTransaction(attempt)).rejects.toBe(failure);
  expect(attempt).toHaveBeenCalledOnce();
});

it("bounds attempts and returns a typed retryable refusal", async () => {
  const attempt = vi.fn().mockRejectedValue({ code: "40P01" });
  await expect(retryTransaction(attempt)).rejects.toMatchObject({ code: "concurrent_write_retry", retryable: true });
  expect(attempt).toHaveBeenCalledTimes(OPERATION_MAX_ATTEMPTS);
});

it("uses the runner's inclusive jitter bounds", () => {
  const random = vi.spyOn(Math, "random").mockReturnValue(0);
  expect(transactionRetryDelayMs(1)).toBe(OPERATION_RETRY_MIN_DELAY_MS);
  random.mockReturnValue(1 - Number.EPSILON);
  expect(transactionRetryDelayMs(1)).toBe(OPERATION_RETRY_MAX_DELAY_MS);
});
