import java.util.Properties

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

val keystoreProps = Properties()
val keystorePropsFile = rootProject.file("keystore.properties")
if (keystorePropsFile.exists()) {
  keystorePropsFile.inputStream().use { keystoreProps.load(it) }
}

fun signingProp(env: String, key: String): String =
  System.getenv(env)?.takeIf { it.isNotBlank() } ?: keystoreProps.getProperty(key).orEmpty()

android {
  namespace = "app.proxora"
  compileSdk = 35

  defaultConfig {
    applicationId = "app.proxora"
    minSdk = 26
    targetSdk = 35
    versionCode = 182
    versionName = "1.7.12"
  }

  val releaseStorePath = signingProp("PROXORA_KEYSTORE_FILE", "storeFile")
  val releaseStorePassword = signingProp("PROXORA_KEYSTORE_PASSWORD", "storePassword")
  val releaseKeyAlias = signingProp("PROXORA_KEY_ALIAS", "keyAlias")
  val releaseKeyPassword = signingProp("PROXORA_KEY_PASSWORD", "keyPassword")
  val releaseStoreFile = releaseStorePath.takeIf { it.isNotBlank() }?.let { path ->
    val candidate = file(path)
    candidate.takeIf { it.isFile }
  }

  signingConfigs {
    if (
      releaseStoreFile != null &&
      releaseStorePassword.isNotBlank() &&
      releaseKeyAlias.isNotBlank() &&
      releaseKeyPassword.isNotBlank()
    ) {
      create("release") {
        storeFile = releaseStoreFile
        storePassword = releaseStorePassword
        keyAlias = releaseKeyAlias
        keyPassword = releaseKeyPassword
        storeType = "PKCS12"
      }
    }
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlinOptions {
    jvmTarget = "17"
  }

  buildFeatures {
    buildConfig = true
  }
}

dependencies {
  implementation("androidx.core:core-ktx:1.15.0")
  implementation("androidx.appcompat:appcompat:1.7.0")
  implementation("com.google.android.material:material:1.12.0")
  implementation("androidx.activity:activity-ktx:1.9.3")
  implementation("androidx.webkit:webkit:1.12.1")
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
