PNPM ?= pnpm
RELEASE_DIR := release-electron
DIST_DIRS := packages/shared/dist packages/preload/dist packages/main/dist packages/renderer/dist

.DEFAULT_GOAL := help

.PHONY: help install dev dev-watch dev-electron build typecheck test test-watch verify verify-signing package-mac deploy clean

help:
	@printf "Available targets:\n"
	@printf "  make install        Install workspace dependencies\n"
	@printf "  make dev            Start workspace watch processes and launch Electron\n"
	@printf "  make dev-watch      Start workspace watch processes only\n"
	@printf "  make dev-electron   Launch Electron against the current build\n"
	@printf "  make build          Build all workspace packages\n"
	@printf "  make typecheck      Run TypeScript type checks\n"
	@printf "  make test           Run Vitest suites\n"
	@printf "  make test-watch     Run Vitest in watch mode\n"
	@printf "  make verify         Run build, typecheck, and tests\n"
	@printf "  make verify-signing Run macOS signing and entitlement checks\n"
	@printf "  make package-mac    Build and package the macOS app\n"
	@printf "  make deploy         Verify and package the macOS app\n"
	@printf "  make clean          Remove generated build artifacts\n"

install:
	$(PNPM) install

dev:
	$(PNPM) dev

dev-watch:
	$(PNPM) dev:watch

dev-electron:
	$(PNPM) dev:electron

build:
	$(PNPM) build

typecheck:
	$(PNPM) typecheck

test:
	$(PNPM) test

test-watch:
	$(PNPM) test:watch

verify: build typecheck test

verify-signing:
	$(PNPM) verify:signing

package-mac:
	$(PNPM) package:mac

deploy: verify package-mac
	@printf "Packaged app is available under %s\n" "$(RELEASE_DIR)"

clean:
	rm -rf $(RELEASE_DIR) $(DIST_DIRS)
