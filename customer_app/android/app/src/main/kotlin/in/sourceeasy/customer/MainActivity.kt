package `in`.sourceeasy.customer

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

/** Update install bridge for the customer app: unknown-sources check/settings and the system package installer. */
class MainActivity : FlutterActivity() {
    private var installer: MethodChannel? = null
    private val actionStatus = "in.sourceeasy.customer.INSTALL_STATUS"

    private fun installWithSession(f: File) {
        val pi = packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        val id = pi.createSession(params)
        pi.openSession(id).use { session ->
            f.inputStream().use { input -> session.openWrite("app.apk", 0, f.length()).use { out -> input.copyTo(out); session.fsync(out) } }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val status = PendingIntent.getBroadcast(this, id, Intent(actionStatus).setPackage(packageName), flags)
            session.commit(status.intentSender)
        }
    }

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            when (val st = i.getIntExtra(PackageInstaller.EXTRA_STATUS, -999)) {
                PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                    @Suppress("DEPRECATION") val confirm = i.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                    if (confirm != null) startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
                PackageInstaller.STATUS_SUCCESS -> {}
                else -> installer?.invokeMethod("installFailed", mapOf("status" to st, "message" to (i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "status $st")))
            }
        }
    }

    companion object { const val CHANNEL = "customer_updates" }

    /** One channel for quote / order / shipment updates, with the default notification sound. */
    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) != null) return
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Quotes, orders and shipments", NotificationManager.IMPORTANCE_HIGH).apply {
            setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            enableVibration(true)
        })
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val filter = IntentFilter(actionStatus)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(statusReceiver, filter, Context.RECEIVER_NOT_EXPORTED) else registerReceiver(statusReceiver, filter)
    }

    override fun onDestroy() { try { unregisterReceiver(statusReceiver) } catch (_: Exception) {}; super.onDestroy() }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        ensureChannel()
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "sourceeasy.customer/notify").setMethodCallHandler { call, result ->
            when (call.method) {
                "requestPermission" -> {
                    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7201)
                    result.success(null)
                }
                "show" -> try {
                    ensureChannel()
                    val open = PendingIntent.getActivity(this, 0, packageManager.getLaunchIntentForPackage(packageName)!!.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                    val n = NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat_notify).setColor(0xFF0E7490.toInt())
                        .setContentTitle(call.argument<String>("title")).setContentText(call.argument<String>("body"))
                        .setPriority(NotificationCompat.PRIORITY_HIGH).setAutoCancel(true).setContentIntent(open).build()
                    if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
                        NotificationManagerCompat.from(this).notify((System.currentTimeMillis() % 100000).toInt(), n)
                    result.success(null)
                } catch (e: Exception) { result.error("notify_failed", e.message, null) }
                else -> result.notImplemented()
            }
        }
        installer = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "sourceeasy.customer/installer")
        installer!!.setMethodCallHandler { call, result ->
            when (call.method) {
                "canInstall" -> result.success(Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls())
                "openInstallSettings" -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
                    result.success(null)
                }
                "install" -> {
                    // Only files inside this app's own cache/updates directory may be installed.
                    val dir = File(cacheDir, "updates").canonicalFile
                    val f = File(call.argument<String>("path")!!).canonicalFile
                    if (f.parentFile != dir || !f.exists() || f.length() == 0L) { result.error("install_failed", "Downloaded file is missing", null); return@setMethodCallHandler }
                    try { installWithSession(f); result.success("session") } catch (e: Exception) {
                        try {
                            val uri = FileProvider.getUriForFile(this, "$packageName.updates", f)
                            startActivity(Intent(Intent.ACTION_VIEW).apply { setDataAndType(uri, "application/vnd.android.package-archive"); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK) })
                            result.success("view")
                        } catch (e2: Exception) { result.error("install_failed", "${e.message}; ${e2.message}", null) }
                    }
                }
                else -> result.notImplemented()
            }
        }
    }
}
