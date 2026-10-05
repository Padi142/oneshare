package com.oneshare.app;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.webkit.MimeTypeMap;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.json.JSONException;

/**
 * Keeps downloaded attachments in OneShare's own storage
 * (Android/data/com.oneshare.app/files/Download/<key>/<file name>) and opens
 * them in whichever app handles the file type, like Telegram does. No storage
 * permission or system download UI is involved.
 */
@CapacitorPlugin(name = "OneShareFiles")
public class OneShareFilesPlugin extends Plugin {
    private static final String APK_MIME_TYPE = "application/vnd.android.package-archive";
    private static final String TEMPORARY_PREFIX = ".download-";
    private static final long MAX_DOWNLOAD_BYTES = 500L * 1024 * 1024;
    private static final long PROGRESS_INTERVAL_MS = 150;

    private final ExecutorService executor = Executors.newFixedThreadPool(3);

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSArray keys = call.getArray("keys");
        JSArray downloaded = new JSArray();
        if (keys != null) {
            for (int index = 0; index < keys.length(); index++) {
                try {
                    String key = keys.getString(index);
                    if (isValidKey(key) && findFile(key) != null) downloaded.put(key);
                } catch (JSONException ignored) {
                    // Skip malformed keys.
                }
            }
        }

        JSObject result = new JSObject();
        result.put("downloaded", downloaded);
        call.resolve(result);
    }

    @PluginMethod
    public void download(PluginCall call) {
        String key = call.getString("key");
        String url = call.getString("url");
        String fileName = call.getString("fileName");
        if (!isValidKey(key) || url == null || fileName == null) {
            call.reject("Invalid file details.");
            return;
        }

        Uri parsedUrl = Uri.parse(url);
        if (
            !"https".equalsIgnoreCase(parsedUrl.getScheme()) ||
            parsedUrl.getHost() == null ||
            parsedUrl.getHost().isEmpty()
        ) {
            call.reject("Only secure downloads are supported.");
            return;
        }

        executor.execute(() -> {
            File existing = findFile(key);
            if (existing != null) {
                JSObject result = new JSObject();
                result.put("fileName", existing.getName());
                call.resolve(result);
                return;
            }

            try {
                File file = downloadTo(key, url, safeFileName(fileName));
                JSObject result = new JSObject();
                result.put("fileName", file.getName());
                call.resolve(result);
            } catch (IOException error) {
                String message = error.getMessage();
                call.reject(message == null || message.isEmpty() ? "Download failed." : message);
            }
        });
    }

    @PluginMethod
    public void open(PluginCall call) {
        String key = call.getString("key");
        File file = isValidKey(key) ? findFile(key) : null;
        if (file == null) {
            call.reject("The file isn't downloaded.", "NOT_DOWNLOADED");
            return;
        }

        String mimeType = mimeTypeFor(file, call.getString("mimeType"));
        if (
            APK_MIME_TYPE.equals(mimeType) &&
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !getContext().getPackageManager().canRequestPackageInstalls()
        ) {
            Intent settings = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName())
            );
            startActivityForResult(call, settings, "installPermissionResult");
            return;
        }

        launchViewer(call, file, mimeType);
    }

    @ActivityCallback
    private void installPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !getContext().getPackageManager().canRequestPackageInstalls()
        ) {
            call.reject("Allow OneShare to install apps to open APK files.", "INSTALL_NOT_ALLOWED");
            return;
        }

        File file = findFile(call.getString("key"));
        if (file == null) {
            call.reject("The file isn't downloaded.", "NOT_DOWNLOADED");
            return;
        }
        launchViewer(call, file, APK_MIME_TYPE);
    }

    private void launchViewer(PluginCall call, File file, String mimeType) {
        Context context = getContext();
        Uri uri = FileProvider.getUriForFile(
            context,
            context.getPackageName() + ".fileprovider",
            file
        );

        try {
            getActivity().startActivity(viewIntent(uri, mimeType));
            call.resolve();
        } catch (ActivityNotFoundException error) {
            // A file with an unusual MIME type may still open in a generic viewer.
            try {
                getActivity().startActivity(
                    Intent.createChooser(viewIntent(uri, "*/*"), file.getName())
                );
                call.resolve();
            } catch (ActivityNotFoundException ignored) {
                call.reject("No app on this device can open " + file.getName() + ".", "NO_APP");
            }
        }
    }

    private static Intent viewIntent(Uri uri, String mimeType) {
        return new Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, mimeType)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    }

    private File downloadTo(String key, String url, String fileName) throws IOException {
        File directory = new File(downloadsRoot(), key);
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new IOException("OneShare couldn't create its download folder.");
        }

        File temporary = new File(directory, TEMPORARY_PREFIX + UUID.randomUUID() + ".tmp");
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IOException("Download failed (" + status + ").");
            }

            long total = connection.getContentLengthLong();
            if (total > MAX_DOWNLOAD_BYTES) {
                throw new IOException("The file is larger than 500 MB.");
            }

            long received = 0;
            long lastProgressAt = 0;
            byte[] buffer = new byte[64 * 1024];
            try (
                InputStream input = connection.getInputStream();
                OutputStream output = new FileOutputStream(temporary)
            ) {
                int read;
                while ((read = input.read(buffer)) != -1) {
                    received += read;
                    if (received > MAX_DOWNLOAD_BYTES) {
                        throw new IOException("The file is larger than 500 MB.");
                    }
                    output.write(buffer, 0, read);

                    long now = System.currentTimeMillis();
                    if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
                        lastProgressAt = now;
                        notifyProgress(key, received, total);
                    }
                }
            }
            notifyProgress(key, received, total);

            // A key holds exactly one file; replace whatever an earlier download left.
            File[] existing = directory.listFiles();
            if (existing != null) {
                for (File candidate : existing) {
                    if (!candidate.equals(temporary)) candidate.delete();
                }
            }

            File destination = new File(directory, fileName);
            if (!temporary.renameTo(destination)) {
                throw new IOException("OneShare couldn't save the file.");
            }
            return destination;
        } finally {
            connection.disconnect();
            if (temporary.exists()) temporary.delete();
        }
    }

    private void notifyProgress(String key, long received, long total) {
        JSObject progress = new JSObject();
        progress.put("key", key);
        progress.put("received", received);
        progress.put("total", total);
        notifyListeners("downloadProgress", progress);
    }

    private File downloadsRoot() {
        File external = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        return external != null
            ? external
            : new File(getContext().getFilesDir(), Environment.DIRECTORY_DOWNLOADS);
    }

    private File findFile(String key) {
        if (!isValidKey(key)) return null;
        File[] files = new File(downloadsRoot(), key).listFiles();
        if (files == null) return null;
        for (File file : files) {
            if (file.isFile() && !file.getName().startsWith(TEMPORARY_PREFIX)) return file;
        }
        return null;
    }

    private static String mimeTypeFor(File file, String declaredMimeType) {
        String name = file.getName();
        int extensionIndex = name.lastIndexOf('.');
        String extension = extensionIndex >= 0
            ? name.substring(extensionIndex + 1).toLowerCase(Locale.ROOT)
            : "";
        if (extension.equals("apk")) return APK_MIME_TYPE;

        if (
            declaredMimeType != null &&
            !declaredMimeType.isEmpty() &&
            !declaredMimeType.equals("application/octet-stream")
        ) {
            return declaredMimeType;
        }

        String guessed = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        return guessed != null ? guessed : "application/octet-stream";
    }

    private static boolean isValidKey(String key) {
        return key != null && key.matches("[A-Za-z0-9_-]{1,128}");
    }

    private static String safeFileName(String value) {
        String fileName = value
            .replaceAll("[\\\\/\\p{Cntrl}]", "-")
            .trim();
        if (
            fileName.isEmpty() ||
            fileName.equals(".") ||
            fileName.equals("..") ||
            fileName.startsWith(TEMPORARY_PREFIX)
        ) {
            return "download";
        }
        return fileName.length() > 240 ? fileName.substring(0, 240) : fileName;
    }
}
