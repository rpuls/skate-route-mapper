package expo.modules.backgroundrecorder

import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BackgroundRecorderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BackgroundRecorder")

    AsyncFunction("startRecording") { rideId: String, intervalMs: Int ->
      val context = requireContext()
      val intent = Intent(context, BackgroundRecorderService::class.java).apply {
        action = BackgroundRecorderService.ACTION_START
        putExtra(BackgroundRecorderService.EXTRA_RIDE_ID, rideId)
        putExtra(BackgroundRecorderService.EXTRA_INTERVAL_MS, intervalMs)
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }

      BackgroundRecorderService.statusMap(context)
    }

    AsyncFunction("stopRecording") {
      val context = requireContext()
      BackgroundRecorderService.stopActiveRecording(context)
      BackgroundRecorderService.statusMap(context)
    }

    AsyncFunction("getStatus") {
      BackgroundRecorderService.statusMap(requireContext())
    }

    AsyncFunction("readSamples") { rideId: String ->
      BackgroundRecorderService.readSamples(requireContext(), rideId)
    }

    AsyncFunction("clearSamples") { rideId: String ->
      BackgroundRecorderService.clearSamples(requireContext(), rideId)
    }
  }

  private fun requireContext(): Context {
    return appContext.reactContext ?: throw IllegalStateException("React context is unavailable")
  }
}
