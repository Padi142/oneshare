# OneShare

A private, account-scoped relay for moving notes, photos, videos, and files between your devices.

The React/Vite renderer is shared by:

- Electron on Linux and macOS
- Capacitor on Android
- A browser during development

Convex provides password authentication, realtime messages, and file storage.

## Development

```bash
bun install
bunx convex dev
bun run dev:web
```

Run the desktop shell against Vite in another terminal:

```bash
bun run dev:desktop
```

## Builds

```bash
bun run typecheck
bun run lint
bun run build
bun run dist
```

Linux builds produce AppImage and deb artifacts. macOS builds produce DMG and ZIP artifacts when run on macOS.

For Android, install Android Studio with a supported JDK and SDK, then run:

```bash
bun run cap:sync
bun run cap:open:android
```

The generated native project lives in `android/`.
