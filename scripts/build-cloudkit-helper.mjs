import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "native/cloudkit-helper/Sources/KanbanCloudKitHelper/main.swift");
const output = resolve(root, "native/cloudkit-helper/dist/KanbanCloudKitHelper");

if (process.platform !== "darwin") {
    process.stdout.write("Skipping CloudKit helper build on non-macOS platform.\n");
    process.exit(0);
}

mkdirSync(dirname(output), { recursive: true });

const result = spawnSync("swiftc", [
    source,
    "-parse-as-library",
    "-framework",
    "Foundation",
    "-framework",
    "CloudKit",
    "-framework",
    "Security",
    "-o",
    output
], { stdio: "inherit" });

if (result.status !== 0) {
    process.exit(result.status ?? 1);
}