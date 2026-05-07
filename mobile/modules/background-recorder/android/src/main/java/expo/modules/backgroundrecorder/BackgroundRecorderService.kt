package expo.modules.backgroundrecorder

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.ParcelUuid
import android.os.SystemClock
import android.util.Log
import java.io.File
import java.io.FileWriter
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import kotlin.math.PI
import kotlin.math.sqrt
import org.json.JSONObject

class BackgroundRecorderService : Service(), SensorEventListener, LocationListener {
  private lateinit var sensorManager: SensorManager
  private lateinit var locationManager: LocationManager
  private var bluetoothAdapter: BluetoothAdapter? = null
  private var sensorThread: HandlerThread? = null
  private var sensorHandler: Handler? = null
  private var writer: FileWriter? = null
  private var lastWriteElapsedMs = 0L
  private var intervalMs = DEFAULT_INTERVAL_MS
  private var sensorSource = SENSOR_SOURCE_PHONE
  private val latestGyro = DoubleArray(3)
  private var latestLocation: Location? = null
  private var bleScanner: BluetoothLeScanner? = null
  private var bleGatt: BluetoothGatt? = null
  private var bleScanCallback: ScanCallback? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    activeService = this
    sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
    locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
    bluetoothAdapter =
      (getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        val requestedRideId = intent.getStringExtra(EXTRA_RIDE_ID)
        if (requestedRideId.isNullOrBlank()) {
          Log.w(TAG, "Start requested without ride id")
          stopSelf()
          return START_NOT_STICKY
        }

        intervalMs = intent.getIntExtra(EXTRA_INTERVAL_MS, DEFAULT_INTERVAL_MS).coerceAtLeast(50)
        sensorSource = intent.getStringExtra(EXTRA_SENSOR_SOURCE) ?: SENSOR_SOURCE_PHONE
        Log.i(TAG, "Starting foreground recorder for ride=$requestedRideId intervalMs=$intervalMs sensorSource=$sensorSource")
        startForeground(NOTIFICATION_ID, buildNotification())
        startRecording(requestedRideId)
      }

      ACTION_STOP -> {
        Log.i(TAG, "Stop requested")
        stopRecording()
        stopSelf()
      }
    }

    return START_STICKY
  }

  override fun onDestroy() {
    stopRecording()
    if (activeService == this) {
      activeService = null
    }
    super.onDestroy()
  }

  override fun onSensorChanged(event: SensorEvent) {
    when (event.sensor.type) {
      Sensor.TYPE_GYROSCOPE -> {
        latestGyro[0] = event.values[0].toDouble()
        latestGyro[1] = event.values[1].toDouble()
        latestGyro[2] = event.values[2].toDouble()
      }

      Sensor.TYPE_ACCELEROMETER -> {
        val elapsedMs = SystemClock.elapsedRealtime()
        if (elapsedMs - lastWriteElapsedMs < intervalMs) {
          return
        }

        lastWriteElapsedMs = elapsedMs
        val sample = sampleFromAccelerometer(event)
        writeSample(sample)
      }
    }
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  override fun onLocationChanged(location: Location) {
    if (shouldAcceptLocation(location)) {
      latestLocation = location
      Log.i(
        TAG,
        "Accepted location provider=${location.provider} lat=${location.latitude} lon=${location.longitude} accuracy=${location.accuracyText()}"
      )
    } else {
      Log.w(
        TAG,
        "Ignored location provider=${location.provider} lat=${location.latitude} lon=${location.longitude} accuracy=${location.accuracyText()}"
      )
    }
  }

  private fun startRecording(rideId: String) {
    if (isRecording && activeRideId == rideId) {
      return
    }

    stopRecording()

    activeRideId = rideId
    activeFile = recordingFile(this, rideId)
    activeFile?.parentFile?.mkdirs()
    writer = FileWriter(activeFile, true)
    sampleCount = countExistingSamples(activeFile)
    latestSample = null
    isRecording = true

    sensorThread = HandlerThread("SkateRecorderSensors").also {
      it.start()
      sensorHandler = Handler(it.looper)
    }

    registerLocation()
    if (sensorSource == SENSOR_SOURCE_EXTERNAL) {
      startBleSensor()
    } else {
      registerSensors()
    }
    Log.i(TAG, "Recorder active file=${activeFile?.absolutePath} existingSamples=$sampleCount")
  }

  private fun stopRecording() {
    if (!isRecording && writer == null) {
      return
    }

    runCatching {
      sensorManager.unregisterListener(this)
    }
    runCatching {
      locationManager.removeUpdates(this)
    }
    stopBleSensor()
    runCatching {
      writer?.flush()
      writer?.close()
    }
    sensorThread?.quitSafely()

    writer = null
    sensorThread = null
    sensorHandler = null
    isRecording = false
    Log.i(TAG, "Recorder stopped ride=$activeRideId samples=$sampleCount")
  }

  private fun registerSensors() {
    val handler = sensorHandler
    val samplingPeriodUs = (intervalMs * 1000).coerceAtLeast(50_000)

    sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)?.let { gyro ->
      sensorManager.registerListener(this, gyro, samplingPeriodUs, handler)
      Log.i(TAG, "Gyroscope registered")
    } ?: run {
      Log.w(TAG, "Gyroscope unavailable")
    }

    sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let { accelerometer ->
      sensorManager.registerListener(this, accelerometer, samplingPeriodUs, handler)
      Log.i(TAG, "Accelerometer registered")
    } ?: run {
      Log.w(TAG, "Accelerometer unavailable")
    }
  }

  private fun registerLocation() {
    if (!hasLocationPermission()) {
      Log.w(TAG, "Location permission unavailable to native service")
      return
    }

    val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
    providers.forEach { provider ->
      runCatching {
        if (locationManager.isProviderEnabled(provider)) {
          locationManager.requestLocationUpdates(provider, 2000L, 3f, this)
          locationManager.getLastKnownLocation(provider)?.let { latestLocation = it }
          Log.i(TAG, "Location provider registered: $provider")
        } else {
          Log.w(TAG, "Location provider disabled: $provider")
        }
      }.onFailure { error ->
        Log.w(TAG, "Unable to register location provider: $provider", error)
      }
    }
  }

  private fun hasLocationPermission(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      return true
    }

    val fine = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    val coarse = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
    return fine == PackageManager.PERMISSION_GRANTED || coarse == PackageManager.PERMISSION_GRANTED
  }

  private fun hasBluetoothPermission(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      return true
    }

    val scan = checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN)
    val connect = checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)
    return scan == PackageManager.PERMISSION_GRANTED && connect == PackageManager.PERMISSION_GRANTED
  }

  @SuppressLint("MissingPermission")
  private fun startBleSensor() {
    if (!hasBluetoothPermission()) {
      Log.w(TAG, "Bluetooth permission unavailable to native service")
      return
    }

    val adapter = bluetoothAdapter
    if (adapter == null || !adapter.isEnabled) {
      Log.w(TAG, "Bluetooth adapter unavailable or disabled")
      return
    }

    bleScanner = adapter.bluetoothLeScanner
    val scanner = bleScanner
    if (scanner == null) {
      Log.w(TAG, "BLE scanner unavailable")
      return
    }

    val filter = ScanFilter.Builder()
      .setServiceUuid(ParcelUuid(NESSO_SERVICE_UUID))
      .build()
    val settings = ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
      .build()

    bleScanCallback = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) {
        val deviceName = result.device.name ?: result.scanRecord?.deviceName
        if (deviceName?.contains("Nesso", ignoreCase = true) != true) {
          return
        }

        Log.i(TAG, "Found Nesso BLE device name=$deviceName address=${result.device.address}")
        stopBleScan()
        bleGatt = result.device.connectGatt(this@BackgroundRecorderService, false, bleGattCallback)
      }

      override fun onScanFailed(errorCode: Int) {
        Log.w(TAG, "Nesso BLE scan failed code=$errorCode")
      }
    }

    Log.i(TAG, "Scanning for Nesso BLE service")
    scanner.startScan(listOf(filter), settings, bleScanCallback)
  }

  @SuppressLint("MissingPermission")
  private fun stopBleSensor() {
    stopBleScan()
    runCatching {
      bleGatt?.disconnect()
      bleGatt?.close()
    }
    bleGatt = null
  }

  @SuppressLint("MissingPermission")
  private fun stopBleScan() {
    val callback = bleScanCallback ?: return
    runCatching {
      bleScanner?.stopScan(callback)
    }
    bleScanCallback = null
  }

  private val bleGattCallback = object : BluetoothGattCallback() {
    @SuppressLint("MissingPermission")
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      if (newState == BluetoothProfile.STATE_CONNECTED) {
        Log.i(TAG, "Nesso BLE connected")
        gatt.discoverServices()
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        Log.w(TAG, "Nesso BLE disconnected status=$status")
      }
    }

    @SuppressLint("MissingPermission")
    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      val characteristic = gatt
        .getService(NESSO_SERVICE_UUID)
        ?.getCharacteristic(NESSO_IMU_CHARACTERISTIC_UUID)

      if (characteristic == null) {
        Log.w(TAG, "Nesso IMU characteristic unavailable")
        return
      }

      gatt.setCharacteristicNotification(characteristic, true)
      characteristic.getDescriptor(CLIENT_CHARACTERISTIC_CONFIG_UUID)?.let { descriptor ->
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          gatt.writeDescriptor(
            descriptor,
            BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
          )
        } else {
          @Suppress("DEPRECATION")
          descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
          @Suppress("DEPRECATION")
          gatt.writeDescriptor(descriptor)
        }
      }
      Log.i(TAG, "Nesso IMU notifications enabled")
    }

    override fun onCharacteristicChanged(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      value: ByteArray
    ) {
      handleNessoPacket(value)
    }

    @Deprecated("Deprecated in Android 13")
    override fun onCharacteristicChanged(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic
    ) {
      @Suppress("DEPRECATION")
      handleNessoPacket(characteristic.value)
    }
  }

  private fun handleNessoPacket(value: ByteArray) {
    if (value.size != NESSO_PACKET_SIZE) {
      Log.w(TAG, "Ignored Nesso packet size=${value.size}")
      return
    }

    val elapsedMs = SystemClock.elapsedRealtime()
    if (elapsedMs - lastWriteElapsedMs < intervalMs) {
      return
    }

    lastWriteElapsedMs = elapsedMs
    writeSample(sampleFromNessoPacket(value))
  }

  private fun shouldAcceptLocation(location: Location): Boolean {
    if (location.latitude !in -90.0..90.0 || location.longitude !in -180.0..180.0) {
      return false
    }

    if (!location.hasAccuracy() || location.accuracy > MAX_ACCEPTED_ACCURACY_METERS) {
      return false
    }

    val previous = latestLocation ?: return true

    if (previous.hasAccuracy()) {
      val previousAccuracy = previous.accuracy
      val networkIsWorseThanGps =
        previous.provider == LocationManager.GPS_PROVIDER &&
          location.provider != LocationManager.GPS_PROVIDER &&
          location.accuracy > previousAccuracy * 1.5f

      if (networkIsWorseThanGps) {
        return false
      }
    }

    val elapsedSeconds = (location.time - previous.time) / 1000.0
    if (elapsedSeconds > 0) {
      val impliedSpeed = previous.distanceTo(location) / elapsedSeconds
      if (impliedSpeed > MAX_REASONABLE_SPEED_MPS && location.accuracy > STRICT_JUMP_ACCURACY_METERS) {
        return false
      }
    }

    return true
  }

  private fun Location.accuracyText(): String {
    return if (hasAccuracy()) "${accuracy}m" else "unknown"
  }

  private fun sampleFromAccelerometer(event: SensorEvent): JSONObject {
    val ax = event.values[0] / SensorManager.GRAVITY_EARTH
    val ay = event.values[1] / SensorManager.GRAVITY_EARTH
    val az = event.values[2] / SensorManager.GRAVITY_EARTH
    val location = latestLocation

    return JSONObject().apply {
      put("timestamp", System.currentTimeMillis())
      put("ax", ax.toDouble())
      put("ay", ay.toDouble())
      put("az", az.toDouble())
      put("gx", latestGyro[0])
      put("gy", latestGyro[1])
      put("gz", latestGyro[2])
      put("vibrationMagnitude", sqrt((ax * ax + ay * ay + az * az).toDouble()))
      putNullable("latitude", location?.latitude)
      putNullable("longitude", location?.longitude)
      putNullable("speed", if (location?.hasSpeed() == true) location.speed.toDouble() else null)
    }
  }

  private fun sampleFromNessoPacket(value: ByteArray): JSONObject {
    val packet = ByteBuffer.wrap(value).order(ByteOrder.LITTLE_ENDIAN)
    packet.int
    packet.int
    val ax = packet.short.toDouble() / 1000.0
    val ay = packet.short.toDouble() / 1000.0
    val az = packet.short.toDouble() / 1000.0
    val gx = (packet.short.toDouble() / 1000.0) * (PI / 180.0)
    val gy = (packet.short.toDouble() / 1000.0) * (PI / 180.0)
    val gz = (packet.short.toDouble() / 1000.0) * (PI / 180.0)
    val location = latestLocation

    return JSONObject().apply {
      put("timestamp", System.currentTimeMillis())
      put("ax", ax)
      put("ay", ay)
      put("az", az)
      put("gx", gx)
      put("gy", gy)
      put("gz", gz)
      put("vibrationMagnitude", sqrt(ax * ax + ay * ay + az * az))
      putNullable("latitude", location?.latitude)
      putNullable("longitude", location?.longitude)
      putNullable("speed", if (location?.hasSpeed() == true) location.speed.toDouble() else null)
    }
  }

  private fun writeSample(sample: JSONObject) {
    val currentWriter = writer ?: return

    runCatching {
      currentWriter.write(sample.toString())
      currentWriter.write("\n")

      sampleCount += 1
      latestSample = jsonToMap(sample)
      if (sampleCount % FLUSH_EVERY_SAMPLES == 0) {
        currentWriter.flush()
      }
      if (sampleCount == 1 || sampleCount % 25 == 0) {
        Log.i(TAG, "Recorded samples=$sampleCount")
      }
    }
  }

  private fun buildNotification(): Notification {
    createNotificationChannel()

    val icon = applicationInfo.icon
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }

    return builder
      .setContentTitle("Recording skate route")
      .setContentText(if (sensorSource == SENSOR_SOURCE_EXTERNAL) "Phone GPS and Nesso IMU are being recorded." else "GPS, accelerometer and gyroscope are being recorded.")
      .setSmallIcon(icon)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .build()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }

    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Ride recording",
      NotificationManager.IMPORTANCE_LOW
    )
    manager.createNotificationChannel(channel)
  }

  private fun JSONObject.putNullable(name: String, value: Double?) {
    if (value == null) {
      put(name, JSONObject.NULL)
    } else {
      put(name, value)
    }
  }

  companion object {
    const val ACTION_START = "expo.modules.backgroundrecorder.START"
    const val ACTION_STOP = "expo.modules.backgroundrecorder.STOP"
    const val EXTRA_RIDE_ID = "rideId"
    const val EXTRA_INTERVAL_MS = "intervalMs"
    const val EXTRA_SENSOR_SOURCE = "sensorSource"
    private const val CHANNEL_ID = "skate-route-recording"
    private const val NOTIFICATION_ID = 4207
    private const val DEFAULT_INTERVAL_MS = 200
    private const val TAG = "BackgroundRecorder"
    private const val FLUSH_EVERY_SAMPLES = 25
    private const val MAX_ACCEPTED_ACCURACY_METERS = 50f
    private const val MAX_REASONABLE_SPEED_MPS = 666.6
    private const val STRICT_JUMP_ACCURACY_METERS = 10f
    private const val SENSOR_SOURCE_PHONE = "phone"
    private const val SENSOR_SOURCE_EXTERNAL = "external"
    private const val NESSO_PACKET_SIZE = 20
    private val NESSO_SERVICE_UUID = UUID.fromString("7b32f8c0-5d0b-4f0e-a1f5-8f30c44c0001")
    private val NESSO_IMU_CHARACTERISTIC_UUID = UUID.fromString("7b32f8c1-5d0b-4f0e-a1f5-8f30c44c0001")
    private val CLIENT_CHARACTERISTIC_CONFIG_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    @Volatile
    private var isRecording = false

    @Volatile
    private var activeRideId: String? = null

    @Volatile
    private var sampleCount = 0

    @Volatile
    private var activeFile: File? = null

    @Volatile
    private var latestSample: Map<String, Any?>? = null

    @Volatile
    private var activeService: BackgroundRecorderService? = null

    fun stopActiveRecording(context: Context) {
      activeService?.let { service ->
        service.stopRecording()
        service.stopSelf()
        return
      }

      val intent = Intent(context, BackgroundRecorderService::class.java).apply {
        action = ACTION_STOP
      }
      context.startService(intent)
    }

    fun statusMap(context: Context): Map<String, Any?> {
      val rideId = activeRideId
      val file = activeFile ?: rideId?.let { recordingFile(context, it) }

      return mapOf(
        "isRecording" to isRecording,
        "rideId" to rideId,
        "sampleCount" to sampleCount,
        "filePath" to file?.absolutePath,
        "latestSample" to latestSample
      )
    }

    fun readSamples(context: Context, rideId: String): List<Map<String, Any?>> {
      val file = recordingFile(context, rideId)
      if (!file.exists()) {
        return emptyList()
      }

      return file.readLines()
        .filter { it.isNotBlank() }
        .mapNotNull { line ->
          runCatching { jsonToMap(JSONObject(line)) }.getOrNull()
        }
    }

    fun clearSamples(context: Context, rideId: String) {
      recordingFile(context, rideId).delete()
    }

    private fun recordingFile(context: Context, rideId: String): File {
      return File(File(context.filesDir, "recordings"), "$rideId.jsonl")
    }

    private fun countExistingSamples(file: File?): Int {
      if (file == null || !file.exists()) {
        return 0
      }

      return file.useLines { lines -> lines.count { it.isNotBlank() } }
    }

    private fun jsonToMap(json: JSONObject): Map<String, Any?> {
      return mapOf(
        "timestamp" to json.getLong("timestamp").toDouble(),
        "ax" to json.getDouble("ax"),
        "ay" to json.getDouble("ay"),
        "az" to json.getDouble("az"),
        "gx" to json.getDouble("gx"),
        "gy" to json.getDouble("gy"),
        "gz" to json.getDouble("gz"),
        "vibrationMagnitude" to json.getDouble("vibrationMagnitude"),
        "latitude" to json.nullableDouble("latitude"),
        "longitude" to json.nullableDouble("longitude"),
        "speed" to json.nullableDouble("speed")
      )
    }

    private fun JSONObject.nullableDouble(name: String): Double? {
      return if (isNull(name)) null else getDouble(name)
    }
  }
}
