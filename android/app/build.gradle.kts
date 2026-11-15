import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
}

// The app's name, id, version and build come from nsh.json, as `nsh package` took them.
val appRoot: File = rootProject.projectDir.parentFile
@Suppress("UNCHECKED_CAST")
val nshJson = JsonSlurper().parse(File(appRoot, "nsh.json")) as Map<String, Any>
val appId = nshJson["id"] as String

// The NSH runtime, fetched by scripts/fetch-nsh-sdk.sh (kept out of git).
val nshAar = rootProject.file("nsh-sdk/nsh.aar")

// The TSX app, compiled to bytecode by `nsh build`, goes in the APK's assets/nsh.
val bundleOut = layout.buildDirectory.dir("generated/nsh-assets")

val nshBundle by tasks.registering {
    description = "Builds the TSX app into assets/nsh with `nsh build --release`."
    val nsh = (findProperty("nsh") as String?) ?: "nsh"
    inputs.files(fileTree(File(appRoot, "src")), File(appRoot, "App.tsx"), File(appRoot, "nsh.json"), File(appRoot, "theme.json"))
    inputs.dir(File(appRoot, "assets"))
    outputs.dir(bundleOut)
    doLast {
        val staging = layout.buildDirectory.dir("nsh-build").get().asFile
        staging.deleteRecursively()
        val run = ProcessBuilder(nsh, "build", "App.tsx", "--release", "--out", staging.absolutePath)
            .directory(appRoot)
            .inheritIO()
            .start()
        if (run.waitFor() != 0) throw GradleException("nsh build failed")
        val out = File(bundleOut.get().asFile, "nsh")
        bundleOut.get().asFile.deleteRecursively()
        out.mkdirs()
        // What the packaged app shipped: the bytecode, the capabilities and the assets (no JS source or map).
        File(staging, "bundle.nshc").copyTo(File(out, "bundle.nshc"))
        File(staging, "capabilities.json").takeIf { it.exists() }?.copyTo(File(out, "capabilities.json"))
        File(staging, "assets").takeIf { it.isDirectory }?.copyRecursively(File(out, "assets"))
        // The app's id: NSH keeps its storage under it, so saved servers carry over from the packaged app.
        File(out, "app.json").writeText("{\"id\":\"$appId\"}")
    }
}

android {
    namespace = "com.meganet.ampmobile"
    compileSdk = 35
    // Only to strip the runtime's debug symbols out of the APK (the AAR ships them).
    ndkVersion = (findProperty("ndkVersion") as String?) ?: "30.0.16248370"

    defaultConfig {
        applicationId = appId
        minSdk = 26
        targetSdk = 35
        versionCode = (nshJson["build"] as Number).toInt()
        versionName = nshJson["version"] as String
        // -Pabis=arm64-v8a,armeabi-v7a for the phones-only APK.
        val abis = (findProperty("abis") as String?) ?: "arm64-v8a,armeabi-v7a,x86_64"
        ndk { abiFilters += abis.split(",").map { it.trim() } }
    }

    // The release key stays outside the repository; the password comes from the environment
    // (scripts/build-release.sh asks for it), never from a file.
    val keystorePassword = System.getenv("AMP_KEYSTORE_PASSWORD")
    signingConfigs {
        create("release") {
            storeFile = file(System.getenv("AMP_RELEASE_KEYSTORE") ?: "${System.getProperty("user.home")}/.android/amp-mobile-release.jks")
            keyAlias = System.getenv("AMP_RELEASE_ALIAS") ?: "amp-mobile"
            storePassword = keystorePassword
            keyPassword = keystorePassword
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (keystorePassword != null) signingConfigs.getByName("release") else null
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets["main"].assets.srcDir(bundleOut)

    packaging {
        // Stored uncompressed and page-aligned, as `nsh package` did (extractNativeLibs=false).
        jniLibs.useLegacyPackaging = false
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

tasks.named("preBuild") { dependsOn(nshBundle) }

dependencies {
    if (!nshAar.exists()) {
        throw GradleException("No NSH runtime at ${nshAar.path}: run scripts/fetch-nsh-sdk.sh first.")
    }
    implementation(files(nshAar))
}
