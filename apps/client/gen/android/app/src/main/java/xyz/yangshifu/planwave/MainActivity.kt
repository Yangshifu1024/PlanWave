package xyz.yangshifu.planwave

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // edge-to-edge 下 WebView 会绘制到系统状态栏/导航栏之下（Android 15+ 对 targetSdk>=35
    // 强制开启，AppCompat 的 fitsSystemWindows 旧机制已不再为内容留边，tauri/wry 也不处理
    // insets）。这里在内容根 android.R.id.content 上把系统栏与刘海 inset 转成 padding，
    // 使 Web 层顶部工具栏（TaskList 的搜索行）不再被状态栏压住。
    // 挂载点必须是 android.R.id.content：WebView 由 wry 在主线程 looper 回调里创建，
    // onCreate 返回后才存在，抓不到。
    val content = findViewById<View>(android.R.id.content)
    val initialPadding =
      intArrayOf(
        content.paddingLeft,
        content.paddingTop,
        content.paddingRight,
        content.paddingBottom
      )
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars =
        insets.getInsets(
          WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
        )
      // 每次都基于初始 padding 重算，避免旋转或多次回调导致 padding 累积
      view.setPadding(
        initialPadding[0] + bars.left,
        initialPadding[1] + bars.top,
        initialPadding[2] + bars.right,
        initialPadding[3] + bars.bottom
      )
      // 不消费 insets：上游当前没有 inset 消费者，返回原值即可；这也是有意偏离官方
      // CONSUMED 示例的地方——API <= 29 上消费后兄弟视图会收不到 insets
      insets
    }
  }
}
