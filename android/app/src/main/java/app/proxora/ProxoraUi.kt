package app.proxora

import android.content.Context
import android.view.ViewGroup
import android.widget.LinearLayout
import com.google.android.material.button.MaterialButton

fun Context.dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

fun Context.proxoraCardWidth(): Int =
  minOf(dp(320), (resources.displayMetrics.widthPixels * 0.86f).toInt())

fun Context.proxoraFilledButton(label: String, onClick: () -> Unit): MaterialButton =
  MaterialButton(this, null, com.google.android.material.R.attr.materialButtonStyle).apply {
    text = label
    isAllCaps = false
    setOnClickListener { onClick() }
  }

fun Context.proxoraOutlinedButton(label: String, onClick: () -> Unit): MaterialButton =
  MaterialButton(this, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
    text = label
    isAllCaps = false
    setOnClickListener { onClick() }
  }

fun buttonRowParams(topMarginPx: Int = 0): LinearLayout.LayoutParams =
  LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
    topMargin = topMarginPx
  }
