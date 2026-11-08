plugins {
    id("com.android.application")
    id("kotlin-android")
    id("dev.flutter.flutter-gradle-plugin")
}

import java.util.Properties

// Push (FCM) is optional: the google-services plugin is applied only when the CUSTOMER project's
// android/app/google-services.json exists (git-ignored; its package must be in.sourceeasy.customer, never the staff app's).
if (file("google-services.json").exists()) apply(plugin = "com.google.gms.google-services")

// Source Easy Customer: its own package and its own signing key (never the staff key).
// Release signing reads a key.properties (storeFile, storePassword, keyAlias, keyPassword) from
// $SOURCEEASY_CUSTOMER_KEY_PROPERTIES, else android/key.properties (git-ignored). Without one, release builds
// fail instead of silently using a debug key.
val keyPropsFile: File? = listOfNotNull(System.getenv("SOURCEEASY_CUSTOMER_KEY_PROPERTIES")?.let { File(it) },
    rootProject.file("key.properties")).firstOrNull { it.exists() }
val keyProps = Properties().apply { keyPropsFile?.inputStream()?.use { load(it) } }

android {
    namespace = "in.sourceeasy.customer"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    kotlinOptions { jvmTarget = JavaVersion.VERSION_11.toString() }

    defaultConfig {
        applicationId = "in.sourceeasy.customer"
        minSdk = maxOf(flutter.minSdkVersion, 23) // flutter_secure_storage
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (keyProps.isNotEmpty()) {
            create("release") {
                storeFile = (keyProps["storeFile"] as String).let { p -> File(p).takeIf { it.isAbsolute } ?: File(keyPropsFile!!.canonicalFile.parentFile, p) }
                storePassword = keyProps["storePassword"] as String
                keyAlias = keyProps["keyAlias"] as String
                keyPassword = keyProps["keyPassword"] as String
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (keyProps.isNotEmpty()) signingConfigs.getByName("release") else null
        }
    }
}

flutter { source = "../.." }
