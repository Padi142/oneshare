package com.oneshare.app;

import android.Manifest;
import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.util.HashSet;
import java.util.Set;

import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "OneShareDownloads",
    permissions = {
        @Permission(
            alias = "publicStorage",
            strings = {Manifest.permission.WRITE_EXTERNAL_STORAGE}
        )
    }
)
public class OneShareDownloadsPlugin extends Plugin {
    @PluginMethod
    public void downloadFiles(PluginCall call) {
        if (
            Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            !hasPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        ) {
            requestPermissionForAlias(
                "publicStorage",
                call,
                "downloadFilesPermissionCallback"
            );
            return;
        }

        enqueueDownloads(call);
    }

    @PermissionCallback
    private void downloadFilesPermissionCallback(PluginCall call) {
        if (!hasPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)) {
            call.reject("Storage permission is required to download files.");
            return;
        }

        enqueueDownloads(call);
    }

    private void enqueueDownloads(PluginCall call) {
        JSArray files = call.getArray("files");
        if (files == null || files.length() == 0) {
            call.reject("No files were selected.");
            return;
        }

        DownloadManager downloadManager =
            (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (downloadManager == null) {
            call.reject("Android downloads are unavailable on this device.");
            return;
        }

        File downloadsDirectory = Environment.getExternalStoragePublicDirectory(
            Environment.DIRECTORY_DOWNLOADS
        );
        Set<String> usedNames = new HashSet<>();
        JSArray enqueued = new JSArray();
        JSArray failed = new JSArray();

        for (int index = 0; index < files.length(); index++) {
            try {
                Object rawFile = files.get(index);
                if (!(rawFile instanceof JSONObject)) {
                    addFailure(failed, "download", "Invalid file details.");
                    continue;
                }

                JSObject file = JSObject.fromJSONObject((JSONObject) rawFile);
                String url = file.getString("url");
                String requestedName = file.getString("fileName");
                if (url == null || requestedName == null) {
                    addFailure(failed, requestedName, "Invalid file details.");
                    continue;
                }

                Uri parsedUrl = Uri.parse(url);
                if (
                    !"https".equalsIgnoreCase(parsedUrl.getScheme()) ||
                    parsedUrl.getHost() == null ||
                    parsedUrl.getHost().isEmpty()
                ) {
                    addFailure(failed, requestedName, "Only secure downloads are supported.");
                    continue;
                }

                String fileName = nextAvailableFileName(
                    downloadsDirectory,
                    safeFileName(requestedName),
                    usedNames
                );
                String mimeType = file.getString(
                    "mimeType",
                    "application/octet-stream"
                );
                DownloadManager.Request request = new DownloadManager.Request(parsedUrl)
                    .setTitle(fileName)
                    .setDescription("OneShare")
                    .setMimeType(mimeType)
                    .setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
                    )
                    .setAllowedOverMetered(true)
                    .setAllowedOverRoaming(true)
                    .setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS,
                        fileName
                    );

                downloadManager.enqueue(request);
                usedNames.add(fileName);
                enqueued.put(fileName);
            } catch (JSONException | IllegalArgumentException error) {
                addFailure(failed, "download", "Android could not start the download.");
            }
        }

        JSObject result = new JSObject();
        result.put("enqueued", enqueued);
        result.put("failed", failed);
        call.resolve(result);
    }

    private static void addFailure(JSArray failed, String fileName, String reason) {
        JSObject failure = new JSObject();
        failure.put("fileName", fileName == null || fileName.isEmpty() ? "file" : fileName);
        failure.put("reason", reason);
        failed.put(failure);
    }

    private static String safeFileName(String value) {
        String fileName = value
            .replaceAll("[\\\\/\\p{Cntrl}]", "-")
            .trim();
        if (fileName.isEmpty() || fileName.equals(".") || fileName.equals("..")) {
            return "download";
        }
        return fileName.length() > 240 ? fileName.substring(0, 240) : fileName;
    }

    private static String nextAvailableFileName(
        File downloadsDirectory,
        String fileName,
        Set<String> usedNames
    ) {
        int attempt = 0;
        String extension = "";
        String stem = fileName;
        int extensionIndex = fileName.lastIndexOf('.');
        if (extensionIndex > 0) {
            stem = fileName.substring(0, extensionIndex);
            extension = fileName.substring(extensionIndex);
        }

        while (true) {
            String suffix = attempt == 0 ? "" : " (" + attempt + ")";
            String candidate = stem + suffix + extension;
            if (!usedNames.contains(candidate) && !new File(downloadsDirectory, candidate).exists()) {
                return candidate;
            }
            attempt++;
        }
    }
}
