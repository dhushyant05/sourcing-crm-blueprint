package com.sourceeasy.app

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
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
class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
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
                        .setSmallIcon(R.mipmap.ic_launcher)
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
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "sourceeasy/installer").setMethodCallHandler { call, result ->
            when (call.method) {
                "canInstall" -> result.success(
                    Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls())
                "openInstallSettings" -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
                    }
                    result.success(null)
                }
                "install" -> try {
                    val f = File(call.argument<String>("path")!!)
                    val uri = FileProvider.getUriForFile(this, "$packageName.updates", f)
                    startActivity(Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(uri, "application/vnd.android.package-archive")
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                    })
                    result.success(true)
                } catch (e: Exception) { result.error("install_failed", e.message, null) }
                else -> result.notImplemented()
            }
        }
    }
}
