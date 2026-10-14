import test from "node:test";
import assert from "node:assert/strict";
import {
  errorMessage,
  formatSol,
  parseGoal,
  parseSol,
} from "../src/lib/amounts.ts";

test("SOL conversion preserves all nine decimal places and u64 boundary", () => {
  assert.equal(parseSol("0.000000001"), 1n);
  assert.equal(parseSol("18446744073.709551615"), (1n << 64n) - 1n);
  assert.equal(formatSol(parseSol("9007199.254740993")), "9007199.254740993");
  assert.equal(formatSol(0n), "0");
  for (const invalid of [
    "0",
    "-1",
    "1e2",
    "NaN",
    "0.0000000001",
    "18446744073.709551616",
  ])
    assert.throws(() => parseSol(invalid));
});

test("names use UTF-8 bytes and locked dates must be future Unix seconds", () => {
  assert.doesNotThrow(() => parseGoal("中".repeat(21), "1", ""));
  assert.doesNotThrow(() => parseGoal("a".repeat(64), "1", ""));
  assert.throws(() => parseGoal("中".repeat(22), "1", ""));
  assert.throws(() => parseGoal(" \t", "1", ""));
  assert.throws(() => parseGoal("目标", "1", "invalid"));
  const now = Date.UTC(2026, 0, 1);
  assert.throws(() => parseGoal("目标", "1", new Date(now).toISOString(), now));
  assert.equal(
    parseGoal("目标", "1", new Date(now + 1000).toISOString(), now).unlockAt,
    BigInt(now / 1000 + 1)
  );
  assert.equal(parseGoal("目标", "1", "").unlockAt, 0n);
});

test("simulation wrappers show their cause and program logs", () => {
  const error = Object.assign(
    new Error(
      "Transaction failed when it was simulated in order to estimate its resource limits."
    ),
    {
      cause: new Error("custom program error: 0x65"),
      context: {
        logs: [
          "Program log: AnchorError: InstructionFallbackNotFound",
          "Program failed: custom program error: 0x65",
        ],
      },
    }
  );
  assert.match(errorMessage(error), /does not match this client/);
  assert.match(errorMessage(new Error("VaultLocked")), /locked until/);
  assert.match(
    errorMessage(new Error("InsufficientVaultFunds")),
    /withdrawable SOL/
  );
  error.cause = new Error("insufficient funds for fee");
  assert.match(errorMessage(error), /Airdrop test SOL/);
  const unknown = Object.assign(new Error("Outer wrapper"), {
    cause: new Error("Actual cause"),
    context: { logs: ["Program failed: custom program error: 0x1234"] },
  });
  assert.match(errorMessage(unknown), /Actual cause/);
  assert.match(errorMessage(unknown), /0x1234/);
  assert.doesNotMatch(errorMessage(unknown), /Outer wrapper/);
  const cycle = Object.assign(new Error("Cyclic error"), {
    cause: null as unknown,
  });
  cycle.cause = cycle;
  assert.equal(errorMessage(cycle), "Cyclic error");
});
