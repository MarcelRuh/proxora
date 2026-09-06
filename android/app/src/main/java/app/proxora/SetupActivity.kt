package app.proxora

import android.os.Bundle
import android.util.TypedValue
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.setPadding

class SetupActivity : AppCompatActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
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

    setContentView(ScrollView(this).apply {
      setBackgroundColor(getColor(R.color.proxora_bg))
      addView(column)
    })

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

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
