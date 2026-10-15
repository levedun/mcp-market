import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearSingletonLocks } from "../src/profile.js";

const dir = mkdtempSync(join(tmpdir(), "profile-"));
writeFileSync(join(dir, "SingletonLock"), "x");
writeFileSync(join(dir, "SingletonCookie"), "x");
writeFileSync(join(dir, "keep.txt"), "ok");
assert.equal(clearSingletonLocks(dir), 2);
assert.equal(existsSync(join(dir, "SingletonLock")), false);
assert.equal(existsSync(join(dir, "keep.txt")), true);
assert.equal(clearSingletonLocks(dir), 0);
rmSync(dir, { recursive: true, force: true });
console.log("profile.test.js: ok");
