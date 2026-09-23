# The 6K Extension native installers

This directory contains the cross-platform native installer source. The payload is copied from `Extensions/the-6k-extension` at packaging time and contains no other extension. The installer stages it at the user's Anime Study Tools extensions folder, installs the Yomitan API native-messaging helper, opens Chrome, and guides the user through one **Load unpacked** step.

The Windows and macOS installers listen on loopback port `19634` for the payload's
`/extension-loaded?extension=the-6k` signal. A matching signal advances the UI
automatically; the manual confirmation remains available when Chrome blocks the
callback or the port is already occupied. After loading, both installers guide
the user through free jpdb account connection and AnkiConnect. They show the
Yomitan API-enablement instruction only when a local `127.0.0.1:19633` check fails.

## macOS

`./build-macos.sh` builds `dist/The 6K Extension Installer.app` and a zip. The
installer uses macOS's built-in `/usr/bin/python3` to launch the bundled Yomitan
API script, rather than distributing a separate embedded Python runtime. A
signed ad-hoc app is suitable for local testing; production distribution should
apply the project's signing/notarization identity.

## Windows

From this directory on Windows, run this single command:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-windows.ps1
```

It first runs `helper/build-windows-host.ps1`, verifies the generated Windows
`yomitan-api-host.exe`, publishes a self-contained `win-x64` single-file
installer to `dist\windows`, and writes
`dist\windows\The6KExtensionInstaller.exe.sha256`. The helper executable is
generated only on Windows and is intentionally not stored in
`windows\resources`. The WinForms app embeds the one extension, the Windows
native-messaging helper, and its license; it does not use the macOS Python
launcher. The Chrome step uses **Ctrl+L**, **Ctrl+V**, and **Select Folder**.

Run `./tests/package-check.sh` on macOS/Linux to validate payload scope and callback filtering.
