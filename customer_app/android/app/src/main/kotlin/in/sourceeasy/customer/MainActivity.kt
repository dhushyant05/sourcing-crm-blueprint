package `in`.sourceeasy.customer

import android.app.PendingIntent
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val filter = IntentFilter(actionStatus)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(statusReceiver, filter, Context.RECEIVER_NOT_EXPORTED) else registerReceiver(statusReceiver, filter)
    }

    override fun onDestroy() { try { unregisterReceiver(statusReceiver) } catch (_: Exception) {}; super.onDestroy() }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
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
