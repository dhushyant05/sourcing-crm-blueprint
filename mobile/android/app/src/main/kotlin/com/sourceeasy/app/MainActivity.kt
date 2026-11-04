package com.sourceeasy.app

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File
import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/** OTA install bridge: unknown-sources permission check/settings and launching the package installer via FileProvider. */
class MainActivity : FlutterFragmentActivity() {
    private var installer: MethodChannel? = null
    private val ACTION_INSTALL_STATUS = "com.sourceeasy.app.INSTALL_STATUS"

    /** PackageInstaller session: streams the APK into the installer (no file URI sharing, works on MIUI/ColorOS). */
    private fun installWithSession(f: File) {
        val pi = packageManager.packageInstaller
        val params = android.content.pm.PackageInstaller.SessionParams(android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(android.content.pm.PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        val id = pi.createSession(params)
        pi.openSession(id).use { session ->
            f.inputStream().use { input -> session.openWrite("app.apk", 0, f.length()).use { out -> input.copyTo(out); session.fsync(out) } }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val status = PendingIntent.getBroadcast(this, id, Intent(ACTION_INSTALL_STATUS).setPackage(packageName), flags)
            session.commit(status.intentSender)
        }
    }

    private val statusReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(c: android.content.Context, i: Intent) {
            when (val st = i.getIntExtra(android.content.pm.PackageInstaller.EXTRA_STATUS, -999)) {
                android.content.pm.PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                    @Suppress("DEPRECATION") val confirm = i.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                    if (confirm != null) startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
                android.content.pm.PackageInstaller.STATUS_SUCCESS -> {}
                else -> installer?.invokeMethod("installFailed", mapOf("status" to st,
                    "message" to (i.getStringExtra(android.content.pm.PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "status $st")))
            }
        }
    }

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        val filter = android.content.IntentFilter(ACTION_INSTALL_STATUS)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(statusReceiver, filter, android.content.Context.RECEIVER_NOT_EXPORTED)
        else registerReceiver(statusReceiver, filter)
    }

    override fun onDestroy() { try { unregisterReceiver(statusReceiver) } catch (_: Exception) {}; super.onDestroy() }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Create the bell channel up front so FCM pushes that arrive while the app is closed also ring the bell.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) try {
            val nm = getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel("alerts_bell") == null) {
                val bell = Uri.parse("android.resource://$packageName/" + R.raw.bell)
                nm.createNotificationChannel(NotificationChannel("alerts_bell", "Source Easy alerts", NotificationManager.IMPORTANCE_HIGH).apply {
                    setSound(bell, android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                    enableVibration(true)
                })
            }
        } catch (_: Exception) {}
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "sourceeasy/notify").setMethodCallHandler { call, result ->
            when (call.method) {
                "requestPermission" -> {
                    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7101)
                    }
                    result.success(null)
                }
                "show" -> try {
                    val bell = Uri.parse("android.resource://$packageName/" + R.raw.bell)
                    val nm = getSystemService(NotificationManager::class.java)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        // Channel sound is fixed at creation, so the bell uses a new channel id.
                        nm.createNotificationChannel(NotificationChannel("alerts_bell", call.argument<String>("channel") ?: "Leads", NotificationManager.IMPORTANCE_HIGH).apply {
                            setSound(bell, android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                            enableVibration(true)
                        })
                        nm.deleteNotificationChannel("leads")
                    }
                    val open = PendingIntent.getActivity(this, 0,
                        packageManager.getLaunchIntentForPackage(packageName)!!.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                    val n = NotificationCompat.Builder(this, "alerts_bell")
                        .setSmallIcon(R.drawable.ic_stat_notify).setColor(0xFF2A9FD6.toInt())
                        .setContentTitle(call.argument<String>("title"))
                        .setContentText(call.argument<String>("body"))
                        .setPriority(NotificationCompat.PRIORITY_HIGH).setSound(bell)
                        .setAutoCancel(true).setContentIntent(open).build()
                    if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
                        NotificationManagerCompat.from(this).notify(call.argument<Int>("id") ?: 1, n)
                    }
                    result.success(null)
                } catch (e: Exception) { result.error("notify_failed", e.message, null) }
                else -> result.notImplemented()
            }
        }
        installer = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "sourceeasy/installer")
        installer!!.setMethodCallHandler { call, result ->
            when (call.method) {
                "canInstall" -> result.success(
                    Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls())
                "openInstallSettings" -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
                    }
                    result.success(null)
                }
                "install" -> {
                    val f = File(call.argument<String>("path")!!)
                    if (!f.exists() || f.length() == 0L) { result.error("install_failed", "Downloaded file is missing", null); return@setMethodCallHandler }
                    try {
                        installWithSession(f)
                        result.success("session")
                    } catch (e: Exception) {
                        // Fallback: hand the file to the system installer via FileProvider.
                        try {
                            val uri = FileProvider.getUriForFile(this, "$packageName.updates", f)
                            startActivity(Intent(Intent.ACTION_VIEW).apply {
                                setDataAndType(uri, "application/vnd.android.package-archive")
                                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                            })
                            result.success("view")
                        } catch (e2: Exception) { result.error("install_failed", "${e.message}; ${e2.message}", null) }
                    }
                }
                "saveDownload" -> try {
                    // Android 10+: MediaStore Downloads (no storage permission). Android 7–9: app's own Download dir via FileProvider.
                    val src = File(call.argument<String>("path")!!)
                    val name = call.argument<String>("name") ?: src.name
                    val mime = call.argument<String>("mime") ?: "application/pdf"
                    val uri: Uri = if (Build.VERSION.SDK_INT >= 29) {
                        val v = android.content.ContentValues().apply {
                            put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name)
                            put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mime)
                            put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS)
                            put(android.provider.MediaStore.MediaColumns.IS_PENDING, 1)
                        }
                        val u = contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, v)!!
                        contentResolver.openOutputStream(u)!!.use { out -> src.inputStream().use { it.copyTo(out) } }
                        v.clear(); v.put(android.provider.MediaStore.MediaColumns.IS_PENDING, 0); contentResolver.update(u, v, null, null)
                        u
                    } else {
                        val dir = getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS)!!; dir.mkdirs()
                        val dst = File(dir, name); src.copyTo(dst, overwrite = true)
                        FileProvider.getUriForFile(this, "$packageName.updates", dst)
                    }
                    result.success(uri.toString())
                } catch (e: Exception) { result.error("save_failed", e.message, null) }
                "openFile" -> try {
                    val raw = call.argument<String>("uri")!!
                    val uri = if (raw.startsWith("/")) FileProvider.getUriForFile(this, "$packageName.updates", File(raw)) else Uri.parse(raw)
                    startActivity(Intent.createChooser(Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(uri, call.argument<String>("mime") ?: "application/pdf")
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    result.success(true)
                } catch (e: Exception) { result.error("open_failed", e.message, null) }
                "openUrl" -> try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(call.argument<String>("url"))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    result.success(true)
                } catch (e: Exception) { result.error("open_failed", e.message, null) }
                else -> result.notImplemented()
            }
        }
    }
}
