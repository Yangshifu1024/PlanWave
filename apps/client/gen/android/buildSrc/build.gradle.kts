plugins {
    `kotlin-dsl`
}

gradlePlugin {
    plugins {
        create("pluginsForCoolKids") {
            id = "rust"
            implementationClass = "RustPlugin"
        }
    }
}

// 国内网络镜像开关：与根 build.gradle.kts 一致，aliyun 对 5xx 硬失败不回落，默认关闭
repositories {
    if (System.getenv("PLANWAVE_CN_MIRROR") == "1") {
        maven("https://maven.aliyun.com/repository/google")
        maven("https://maven.aliyun.com/repository/central")
    }
    google()
    mavenCentral()
}

dependencies {
    compileOnly(gradleApi())
    implementation("com.android.tools.build:gradle:8.11.0")
}

