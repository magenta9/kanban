import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const appPath = resolve(process.env.KANBAN_SIGNED_APP_PATH ?? `${root}/release-electron/mac-arm64/Kanban.app`);
const helperPath = `${appPath}/Contents/Resources/KanbanCloudKitHelper`;
const expectedContainer = process.env.KANBAN_CLOUDKIT_CONTAINER ?? "iCloud.com.magenta9.kanban";
const allowAdhoc = process.argv.includes("--allow-adhoc");

const failures = [];

function run(command, args, input) {
    const result = spawnSync(command, args, {
        input,
        encoding: "utf8"
    });
    return {
        status: result.status ?? 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? ""
    };
}

function requireFile(path, label) {
    if (!existsSync(path)) {
        failures.push(`${label} is missing: ${path}`);
    }
}

function verifyCodeSignature(path, label, deep = false) {
    const args = ["--verify"];
    if (deep) args.push("--deep");
    args.push("--strict", "--verbose=2", path);
    const result = run("codesign", args);
    if (result.status !== 0) {
        failures.push(`${label} codesign verification failed:\n${result.stderr || result.stdout}`);
    }
}

function readEntitlements(path, label) {
    const result = run("codesign", ["-d", "--entitlements", ":-", path]);
    if (result.status !== 0) {
        failures.push(`${label} entitlements could not be read:\n${result.stderr || result.stdout}`);
        return "";
    }
    return result.stdout;
}

function readSignatureDetails(path, label) {
    const result = run("codesign", ["-dvv", path]);
    if (result.status !== 0) {
        failures.push(`${label} signature details could not be read:\n${result.stderr || result.stdout}`);
        return "";
    }
    return result.stderr || result.stdout;
}

function requireCloudKitEntitlements(entitlements, label) {
    if (!entitlements.includes("com.apple.developer.icloud-services") || !entitlements.includes("CloudKit")) {
        failures.push(`${label} is missing the CloudKit service entitlement.`);
    }
    if (!entitlements.includes("com.apple.developer.icloud-container-identifiers") || !entitlements.includes(expectedContainer)) {
        failures.push(`${label} is missing the expected iCloud container entitlement: ${expectedContainer}`);
    }
}

function requireNonAdhocSignature(details, label) {
    const isAdhoc = details.includes("Signature=adhoc") || details.includes("TeamIdentifier=not set");
    if (isAdhoc && !allowAdhoc) {
        failures.push(`${label} is ad-hoc signed. CloudKit requires an Apple certificate and matching provisioning profile.`);
    }
}

requireFile(appPath, "App bundle");
requireFile(helperPath, "CloudKit helper");

if (failures.length === 0) {
    verifyCodeSignature(appPath, "App bundle", true);
    verifyCodeSignature(helperPath, "CloudKit helper");
    const appEntitlements = readEntitlements(appPath, "App bundle");
    const helperEntitlements = readEntitlements(helperPath, "CloudKit helper");
    const appDetails = readSignatureDetails(appPath, "App bundle");
    const helperDetails = readSignatureDetails(helperPath, "CloudKit helper");

    requireCloudKitEntitlements(appEntitlements, "App bundle");
    requireCloudKitEntitlements(helperEntitlements, "CloudKit helper");
    requireNonAdhocSignature(appDetails, "App bundle");
    requireNonAdhocSignature(helperDetails, "CloudKit helper");
}

if (failures.length > 0) {
    process.stderr.write(`Signing verification failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
    process.exit(1);
}

process.stdout.write(`Signing verification passed for ${appPath}\n`);