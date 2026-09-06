package app.proxora

import android.os.Bundle
import android.util.TypedValue
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.LinearLayoutCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.setPadding
import androidx.core.view.updatePadding

class SetupActivity : AppCompatActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    val barColor = 0xFF0A0A0F.toInt()
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(barColor),
      navigationBarStyle = SystemBarStyle.dark(barColor),
    )
    super.onCreate(savedInstanceState)

    val pad = dp(20)
    val url = EditText(this).apply {
      hint = getString(R.string.setup_url)
      setText(Prefs.serverUrl(this@SetupActivity).orEmpty())
      setTextColor(getColor(R.color.proxora_fg))
      setHintTextColor(getColor(R.color.proxora_muted))
      setBackgroundColor(getColor(R.color.proxora_surface))
      setPadding(dp(12), dp(14), dp(12), dp(14))
      isSingleLine = true
      inputType = android.text.InputType.TYPE_TEXT_VARIATION_URI
    }
    val insecure = CheckBox(this).apply {
      text = getString(R.string.setup_insecure)
      setTextColor(getColor(R.color.proxora_muted))
      isChecked = Prefs.allowInsecureTls(this@SetupActivity)
    }
    val connect = Button(this).apply {
      text = getString(R.string.setup_connect)
      setOnClickListener {
        val normalized = ServerUrl.normalize(url.text.toString())
        if (normalized == null) {
          Toast.makeText(this@SetupActivity, R.string.setup_invalid, Toast.LENGTH_LONG).show()
          return@setOnClickListener
        }
        Prefs.save(this@SetupActivity, normalized, insecure.isChecked)
        setResult(RESULT_OK)
        finish()
      }
    }

    val column = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(pad)
      addView(TextView(this@SetupActivity).apply {
        text = getString(R.string.setup_title)
        setTextColor(getColor(R.color.proxora_fg))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
      })
      addView(TextView(this@SetupActivity).apply {
        text = getString(R.string.setup_hint)
        setTextColor(getColor(R.color.proxora_muted))
        setPadding(0, dp(10), 0, dp(18))
      })
      addView(url)
      addView(insecure.apply { setPadding(0, dp(12), 0, dp(16)) })
      addView(connect)
    }

    val statusSpacer = View(this).apply {
      setBackgroundColor(getColor(R.color.proxora_bg))
    }
    val scroll = ScrollView(this).apply {
      addView(column)
    }
    val root = LinearLayoutCompat(this).apply {
      orientation = LinearLayoutCompat.VERTICAL
      setBackgroundColor(getColor(R.color.proxora_bg))
      addView(
        statusSpacer,
        LinearLayoutCompat.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, statusBarFallbackPx()),
      )
      addView(
        scroll,
        LinearLayoutCompat.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f),
      )
    }
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      val top = maxOf(
        insets.getInsets(WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.displayCutout()).top,
        statusBarFallbackPx(),
      )
      statusSpacer.layoutParams = LinearLayoutCompat.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, top)
      val sides = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val bottom = insets.getInsets(WindowInsetsCompat.Type.navigationBars() or WindowInsetsCompat.Type.ime()).bottom
      view.updatePadding(left = sides.left, right = sides.right, bottom = bottom)
      WindowInsetsCompat.CONSUMED
    }
    setContentView(root)
    WindowCompat.getInsetsController(window, window.decorView).apply {
      show(WindowInsetsCompat.Type.statusBars())
      isAppearanceLightStatusBars = false
      isAppearanceLightNavigationBars = false
    }
    ViewCompat.requestApplyInsets(root)

    onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          if (Prefs.serverUrl(this@SetupActivity).isNullOrBlank()) finishAffinity()
          else finish()
        }
      },
    )
  }

  private fun statusBarFallbackPx(): Int {
    val id = resources.getIdentifier("status_bar_height", "dimen", "android")
    if (id > 0) return resources.getDimensionPixelSize(id)
    return (24 * resources.displayMetrics.density).toInt()
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
