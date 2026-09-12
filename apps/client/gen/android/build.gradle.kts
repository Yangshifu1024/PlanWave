// 国内网络镜像开关：本地构建前设置 PLANWAVE_CN_MIRROR=1 启用阿里云镜像（置于官方源之前）；
// CI（GitHub Actions）不设置，直接走 google()/mavenCentral()。
// 注意 gradle 对镜像源的 5xx 是硬失败不会回落，所以镜像默认关闭。
buildscript {
    repositories {
        if (System.getenv("PLANWAVE_CN_MIRROR") == "1") {
            maven("https://maven.aliyun.com/repository/google")
            maven("https://maven.aliyun.com/repository/central")
        }
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.11.0")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25")
    }
}

allprojects {
    repositories {
        if (System.getenv("PLANWAVE_CN_MIRROR") == "1") {
            maven("https://maven.aliyun.com/repository/google")
            maven("https://maven.aliyun.com/repository/central")
        }
        google()
        mavenCentral()
    }
}

tasks.register("clean").configure {
    delete("build")
}
