plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

import java.util.Properties

// Release signing: key.properties (storeFile, storePassword, keyAlias, keyPassword) is read from
// $SOURCEEASY_KEY_PROPERTIES, else android/key.properties, else android/app/key.properties (all git-ignored,
// android/key.properties may be a symlink to a secrets folder). storeFile may be absolute or relative to that file.
// If none exists, release builds fall back to the debug key.
val keyPropsFile: File? = listOfNotNull(System.getenv("SOURCEEASY_KEY_PROPERTIES")?.let { File(it) },
    rootProject.file("key.properties"), rootProject.file("app/key.properties")).firstOrNull { it.exists() }
val keyProps = Properties().apply { keyPropsFile?.inputStream()?.use { load(it) } }

android {
    namespace = "com.sourceeasy.app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_11.toString()
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.sourceeasy.app"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion // flutter_secure_storage needs >= 23
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
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = if (keyProps.isNotEmpty()) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1") // FileProvider for OTA installs
}
