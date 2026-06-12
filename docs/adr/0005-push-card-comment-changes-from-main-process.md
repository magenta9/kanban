# Push card comment changes from the main process

Card comment updates that originate in the main process, including Agent Run progress and completion updates, should be pushed to the renderer through IPC events instead of discovered by renderer polling. We chose push events because the app is a local Electron application with one main process already owning persistence, while polling would add stale UI windows and repeated database reads without solving cross-device or multi-instance collaboration.
