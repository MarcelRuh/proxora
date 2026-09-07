package app.proxora

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

object BiometricGate {
  fun available(activity: FragmentActivity): Boolean {
    val manager = BiometricManager.from(activity)
    return manager.canAuthenticate(
      BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL,
    ) == BiometricManager.BIOMETRIC_SUCCESS
  }

  fun prompt(activity: FragmentActivity, onUnlocked: () -> Unit, onFailed: () -> Unit) {
    if (!Prefs.biometricLock(activity) || !available(activity)) {
      onUnlocked()
      return
    }
    val prompt = BiometricPrompt(
      activity,
      ContextCompat.getMainExecutor(activity),
      object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
          onUnlocked()
        }

        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
          if (
            errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
            errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
            errorCode == BiometricPrompt.ERROR_CANCELED
          ) {
            onFailed()
          } else {
            onFailed()
          }
        }

        override fun onAuthenticationFailed() {
          /* keep locked; system retries */
        }
      },
    )
    prompt.authenticate(
      BiometricPrompt.PromptInfo.Builder()
        .setTitle(activity.getString(R.string.biometric_title))
        .setSubtitle(activity.getString(R.string.biometric_body))
        .setAllowedAuthenticators(
          BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL,
        )
        .build(),
    )
  }
}
